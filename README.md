# saas-metrics

[![CI](https://github.com/Ph20sr/saas-metrics/actions/workflows/ci.yml/badge.svg)](https://github.com/Ph20sr/saas-metrics/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

As métricas que todo SaaS precisa no painel administrativo, calculadas a partir do histórico das assinaturas: **MRR**, **movimentação** (novo, expansão, contração, churn e reativação), **churn**, **NRR**, **ARPU**, **LTV** e **retenção por safra**. Não tem dependências.

Os testes usam um cenário calculado à mão, com upgrade, downgrade, cancelamento, retorno de cliente e plano anual. A movimentação sempre fecha a conta:

```
MRR inicial + novo + reativação + expansão − contração − churn = MRR final
```

## Entrada

Para cada assinatura, a lista de mudanças de MRR (0 = cancelada). É fácil montar a partir dos webhooks do seu gateway (Asaas, Stripe...):

```js
import { toMonthly } from 'saas-metrics';

const subs = [
  { id: 'sub_1', customerId: 'cli_A', changes: [{ at: '2026-01-05', mrr: 99 }, { at: '2026-03-10', mrr: 149 }] },
  { id: 'sub_2', customerId: 'cli_B', changes: [{ at: '2026-01-20', mrr: 49 }, { at: '2026-02-15', mrr: 0 }] },
  { id: 'sub_3', customerId: 'cli_C', changes: [{ at: '2026-03-01', mrr: toMonthly(1188, 'year') }] }, // anual → 99/mês
];
```

## Uso

```js
import { mrrAt, monthlyReport, ltv, cohorts } from 'saas-metrics';

mrrAt(subs, '2026-03-31'); // 248 (149 + 99; cli_B cancelou)

const report = monthlyReport(subs, '2026-01', '2026-06');
// [{
//   month: '2026-03', startMrr, endMrr, net,
//   new, reactivation, expansion, contraction, churn,
//   customers: { start, end, new, reactivated, churned },
//   customerChurnRate: 0.05,   // clientes perdidos ÷ clientes no início
//   revenueChurnRate: 0.031,   // (churn + contração) ÷ MRR inicial
//   nrr: 1.04,                 // retenção líquida de receita (> 1 = a base cresce sozinha)
//   arpu: 112.5
// }, ...]

const last = report.at(-1);
ltv(last.arpu, last.customerChurnRate, 0.8); // com 80% de margem bruta

cohorts(subs, '2026-01', '2026-06');
// [{ cohort: '2026-01', size: 2, retention: [1, 0.5, 0.5, ...] }, ...]
```

## Definições

| métrica | como é calculada |
| --- | --- |
| **MRR** | soma do MRR de todas as assinaturas ativas na data (planos anuais divididos por 12) |
| **novo** | cliente sem MRR no início do período e com MRR no fim, que **nunca** tinha pago |
| **reativação** | como "novo", mas o cliente já tinha pago antes (voltou) |
| **expansão / contração** | aumento ou redução do MRR de um cliente que continuou ativo |
| **churn** | MRR de clientes ativos no início e sem MRR no fim |
| **NRR** | (MRR inicial + expansão − contração − churn) ÷ MRR inicial |
| **LTV** | ARPU × margem bruta ÷ churn mensal de clientes |
| **safra** | clientes agrupados pelo mês do primeiro pagamento; retenção = fração ativa no fim de cada mês |

O MRR "do mês" é medido no último dia do mês. Assim, uma assinatura que começa no dia 1º conta naquele mês, e um cancelamento no dia 31 conta no mês seguinte.

## Desenvolvimento

```bash
npm test
```

## Licença

MIT
