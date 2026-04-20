/**
 * Exclui das somas de gasto/receita tudo que é "dinheiro mudando de lugar":
 *   - Transferências entre contas próprias (`kind='transfer'`).
 *   - Aportes de investimento (`kind='investment_in'`).
 *   - Retiradas/resgates de investimento (`kind='investment_out'`).
 *
 * Essas transações continuam visíveis em Lançamentos e entram nos relatórios
 * específicos (Dashboard card "Guardado", tela de Investimentos). Só não
 * distorcem os totais de gasto/receita.
 *
 * Use `SQL_NOT_TRANSFER_JOIN` no `FROM` (apelida a categoria como `ct`) e
 * `SQL_NOT_TRANSFER_WHERE` no `WHERE` pra aplicar o filtro.
 */
export const SQL_NOT_TRANSFER_JOIN = 'LEFT JOIN categories ct ON ct.id = t.category_id'
export const SQL_NOT_TRANSFER_WHERE =
  "(ct.kind IS NULL OR ct.kind NOT IN ('transfer','investment_in','investment_out'))"

/** Mantido pra retrocompat de relatórios que explicitamente querem só transfer. */
export const SQL_IS_TRANSFER = "(ct.kind = 'transfer')"

export const SQL_IS_INVESTMENT_IN = "(ct.kind = 'investment_in')"
export const SQL_IS_INVESTMENT_OUT = "(ct.kind = 'investment_out')"
export const SQL_IS_INVESTMENT_MOVEMENT = "(ct.kind IN ('investment_in','investment_out'))"
