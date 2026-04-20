/**
 * Mês usado em totais e filtros: o mês que você informou ao importar o extrato (`billing_ref_ym`),
 * ou o mês civil da data do lançamento quando veio vazio (ex.: manual).
 */
export const SQL_EFFECTIVE_SPEND_MONTH = `COALESCE(t.billing_ref_ym, strftime('%Y-%m', t.occurred_at))`.trim()
