import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMonthly, mrrAt, movement, monthlyReport, ltv, cohorts, monthRange } from '../src/index.js';

// Cenário calculado à mão:
// A: entra 05/01 com 100; sobe para 150 em 10/03
// B: entra 20/01 com 50; cancela 15/02; volta 02/04 com 50 (reativação)
// C: entra 03/02 com 200; desce para 120 em 20/03
// D: entra 01/03 no plano anual de 1200 (= 100/mês)
const subs = [
  { id: 's1', customerId: 'A', changes: [{ at: '2026-01-05', mrr: 100 }, { at: '2026-03-10', mrr: 150 }] },
  { id: 's2', customerId: 'B', changes: [{ at: '2026-01-20', mrr: 50 }, { at: '2026-02-15', mrr: 0 }] },
  { id: 's5', customerId: 'B', changes: [{ at: '2026-04-02', mrr: 50 }] },
  { id: 's3', customerId: 'C', changes: [{ at: '2026-03-20', mrr: 120 }, { at: '2026-02-03', mrr: 200 }] }, // fora de ordem de propósito
  { id: 's4', customerId: 'D', changes: [{ at: '2026-03-01', mrr: toMonthly(1200, 'year') }] },
];

test('toMonthly normaliza o intervalo de cobrança', () => {
  assert.equal(toMonthly(1200, 'year'), 100);
  assert.equal(toMonthly(297, 'quarter'), 99);
  assert.equal(toMonthly(49.9), 49.9);
  assert.throws(() => toMonthly(10, 'week'), RangeError);
});

test('MRR numa data', () => {
  assert.equal(mrrAt(subs, '2025-12-31'), 0);
  assert.equal(mrrAt(subs, '2026-01-31'), 150);
  assert.equal(mrrAt(subs, '2026-03-31'), 370);
  assert.equal(mrrAt(subs, '2026-04-30'), 420);
});

test('movimentação fecha a conta', () => {
  const mv = movement(subs, '2026-02-28', '2026-03-31');
  assert.deepEqual(
    { start: mv.startMrr, new: mv.new, exp: mv.expansion, con: mv.contraction, churn: mv.churn, end: mv.endMrr },
    { start: 300, new: 100, exp: 50, con: 80, churn: 0, end: 370 },
  );
  assert.equal(mv.startMrr + mv.new + mv.reactivation + mv.expansion - mv.contraction - mv.churn, mv.endMrr);
});

test('relatório mensal: churn, NRR, ARPU e reativação', () => {
  const [jan, feb, mar, apr] = monthlyReport(subs, '2026-01', '2026-04');

  assert.equal(jan.new, 150);
  assert.equal(jan.customerChurnRate, null, 'sem clientes no início do mês');

  assert.equal(feb.startMrr, 150);
  assert.equal(feb.churn, 50);
  assert.equal(feb.new, 200);
  assert.equal(feb.customerChurnRate, 0.5);
  assert.equal(feb.revenueChurnRate, 0.3333);
  assert.equal(feb.nrr, 0.6667);
  assert.equal(feb.arpu, 150);

  assert.equal(mar.new, 100, 'D entrou no dia 1º e conta em março');
  assert.equal(mar.nrr, 0.9);
  assert.equal(mar.revenueChurnRate, 0.2667);
  assert.deepEqual(mar.customers, { start: 2, end: 3, new: 1, reactivated: 0, churned: 0 });

  assert.equal(apr.reactivation, 50);
  assert.equal(apr.new, 0, 'B voltou: é reativação, não cliente novo');
  assert.equal(apr.endMrr, 420);
});

test('LTV', () => {
  assert.equal(ltv(150, 0.05), 3000);
  assert.equal(ltv(150, 0.05, 0.8), 2400);
  assert.equal(ltv(150, 0), null);
});

test('retenção por safra', () => {
  const rows = cohorts(subs, '2026-01', '2026-04');
  assert.deepEqual(rows[0], { cohort: '2026-01', size: 2, retention: [1, 0.5, 0.5, 1] });
  assert.deepEqual(rows[1], { cohort: '2026-02', size: 1, retention: [1, 1, 1] });
  assert.deepEqual(rows[2], { cohort: '2026-03', size: 1, retention: [1, 1] });
  assert.deepEqual(rows[3], { cohort: '2026-04', size: 0, retention: [null] });
});

test('monthRange atravessa a virada do ano', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});
