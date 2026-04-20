/**
 * Transferências entre contas próprias (ex.: mandar da corrente pra carteira, pagar fatura do cartão)
 * não são receita nem despesa — apenas dinheiro trocando de lugar.
 *
 * Convenção: usamos uma categoria de `kind='transfer'` para marcá-las. Estas queries
 * excluem-nas dos totais do dashboard e da análise. As transações continuam visíveis em
 * "Lançamentos" e nas listagens cruas.
 *
 * Use `SQL_NOT_TRANSFER_JOIN` no `FROM` e `SQL_NOT_TRANSFER_WHERE` no `WHERE` para aplicar o filtro.
 */
export const SQL_NOT_TRANSFER_JOIN = 'LEFT JOIN categories ct ON ct.id = t.category_id'
export const SQL_NOT_TRANSFER_WHERE = "(ct.kind IS NULL OR ct.kind != 'transfer')"
export const SQL_IS_TRANSFER = "(ct.kind = 'transfer')"
