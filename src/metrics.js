// Métricas de assinatura a partir do histórico de MRR de cada assinatura.
//
// Modelo de entrada:
//   { id, customerId, changes: [{ at: 'YYYY-MM-DD', mrr: 99.9 }, { at: '2026-05-10', mrr: 0 }] }
// Cada "change" diz qual passou a ser o MRR naquela data (0 = cancelada).

const round2 = (n) => Math.round(n * 100) / 100;

/** Converte o valor cobrado para MRR (receita mensal recorrente). */
export function toMonthly(amount, interval = 'month') {
  const months = { month: 1, quarter: 3, semester: 6, year: 12 }[interval];
  if (!months) throw new RangeError(`Intervalo desconhecido: ${interval}`);
  return round2(amount / months);
}

function mrrOf(sub, date) {
  let value = 0;
  for (const c of sub.changes) {
    if (c.at <= date) value = c.mrr;
    else break;
  }
  return value;
}

function sorted(subs) {
  return subs.map((s) => ({ ...s, changes: [...s.changes].sort((a, b) => a.at.localeCompare(b.at)) }));
}

/** MRR por cliente numa data (soma das assinaturas do cliente). */
export function customerMrr(subs, date) {
  const map = new Map();
  for (const sub of sorted(subs)) {
    const v = mrrOf(sub, date);
    map.set(sub.customerId, round2((map.get(sub.customerId) ?? 0) + v));
  }
  return map;
}

export function mrrAt(subs, date) {
  return round2([...customerMrr(subs, date).values()].reduce((a, b) => a + b, 0));
}

/**
 * Movimentação de MRR entre duas datas, por cliente:
 * new, reactivation (voltou depois de cancelar), expansion, contraction, churn.
 * Sempre vale: start + new + reactivation + expansion − contraction − churn = end.
 */
export function movement(subs, from, to) {
  const before = customerMrr(subs, from);
  const after = customerMrr(subs, to);
  const everPaid = (customerId) => subs.some((s) => s.customerId === customerId
    && s.changes.some((c) => c.at < from && c.mrr > 0));

  const m = { new: 0, reactivation: 0, expansion: 0, contraction: 0, churn: 0 };
  const customers = { start: 0, end: 0, new: 0, reactivated: 0, churned: 0 };

  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id) ?? 0;
    const b = after.get(id) ?? 0;
    if (a > 0) customers.start++;
    if (b > 0) customers.end++;
    if (a === 0 && b > 0) {
      if (everPaid(id)) { m.reactivation += b; customers.reactivated++; } else { m.new += b; customers.new++; }
    } else if (a > 0 && b === 0) {
      m.churn += a;
      customers.churned++;
    } else if (b > a) m.expansion += b - a;
    else if (b < a) m.contraction += a - b;
  }

  for (const k of Object.keys(m)) m[k] = round2(m[k]);
  const startMrr = round2([...before.values()].reduce((x, y) => x + y, 0));
  const endMrr = round2([...after.values()].reduce((x, y) => x + y, 0));
  return { from, to, startMrr, endMrr, ...m, net: round2(endMrr - startMrr), customers };
}

/** Último dia do mês YYYY-MM (é nele que medimos o MRR "do mês"). */
function lastDay(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function prevMonth(ym) {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}
function nextMonth(ym) {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

/** Lista de meses YYYY-MM de `from` até `to`, inclusive. */
export function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : null);

/**
 * Relatório mensal: MRR e movimentação de cada mês, churn de clientes
 * (logo churn), churn de receita, NRR e ARPU.
 */
export function monthlyReport(subs, from, to) {
  return monthRange(from, to).map((ym) => {
    const mv = movement(subs, lastDay(prevMonth(ym)), lastDay(ym));
    return {
      month: ym,
      ...mv,
      customerChurnRate: ratio(mv.customers.churned, mv.customers.start),
      revenueChurnRate: ratio(mv.churn + mv.contraction, mv.startMrr),
      nrr: ratio(mv.startMrr + mv.expansion - mv.contraction - mv.churn, mv.startMrr),
      arpu: mv.customers.end ? round2(mv.endMrr / mv.customers.end) : null,
    };
  });
}

/** LTV = ARPU × margem ÷ churn mensal de clientes. null se churn = 0. */
export function ltv(arpu, monthlyChurnRate, grossMargin = 1) {
  if (!monthlyChurnRate || arpu == null) return null;
  return round2((arpu * grossMargin) / monthlyChurnRate);
}

/**
 * Retenção por safra: clientes agrupados pelo mês em que começaram a pagar;
 * para cada mês seguinte, a fração que ainda pagava no fim daquele mês.
 */
export function cohorts(subs, from, to) {
  const months = monthRange(from, to);
  const firstPaid = new Map();
  for (const sub of sorted(subs)) {
    const first = sub.changes.find((c) => c.mrr > 0);
    if (!first) continue;
    const ym = first.at.slice(0, 7);
    const cur = firstPaid.get(sub.customerId);
    if (!cur || ym < cur) firstPaid.set(sub.customerId, ym);
  }

  return months.map((cohort, ci) => {
    const members = [...firstPaid].filter(([, ym]) => ym === cohort).map(([id]) => id);
    const retention = months.slice(ci).map((ym) => {
      if (!members.length) return null;
      const mrr = customerMrr(subs, lastDay(ym));
      const alive = members.filter((id) => (mrr.get(id) ?? 0) > 0).length;
      return Math.round((alive / members.length) * 10000) / 10000;
    });
    return { cohort, size: members.length, retention };
  });
}
