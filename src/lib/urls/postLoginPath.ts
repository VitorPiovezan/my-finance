/**
 * Destino após login com Drive: respeita `state.from` enviado pelo GoogleAccessGate
 * quando o utilizador tentou abrir uma rota protegida sem sessão.
 */
export function resolvePostLoginNavigatePath(state: unknown): string {
  const from = (state as { from?: string } | null)?.from
  if (
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    from !== '/entrar' &&
    from !== '/primeiro-acesso'
  ) {
    return from
  }
  return '/'
}
