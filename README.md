# My Finance

App pessoal de finanças que roda 100% no navegador. O banco de dados é um
SQLite (via `sql.js`) salvo no IndexedDB do seu navegador — nada vai pra um
backend. Você pode exportar o `.sqlite` a qualquer momento e restaurar
depois.

Funcionalidades principais:

- Importação de CSVs de extrato (Mercado Pago, Nubank cartão/conta, local).
- Sincronização opcional via Google Drive (pasta por banco → subpastas `cartao`/`conta`).
- Categorização com Gemini (opcional) + regras locais aprendidas conforme você categoriza.
- Visão geral com projeção de fim de mês, destaques de variação e recordes do ano.
- Análise "Por categoria" com heatmap anual, drill-down de transações e comparativos.
- Agenda de lançamentos futuros + atalhos rápidos.
- Backup/restauração do banco completo em `.sqlite`.

## Rodar local

```bash
npm install
cp .env.example .env      # preencha conforme quiser
npm run dev
```

## Build

```bash
npm run build
```

O `VITE_BASE_PATH` controla o caminho base dos assets. Em dev e em build
tradicional, fica `/`. No deploy pro GitHub Pages, o workflow seta
`/my-finance/` automaticamente.

## Deploy no GitHub Pages

Este repo traz um workflow em `.github/workflows/deploy.yml` que:

1. Roda em cada push pra `main`.
2. Faz `npm run build` injetando secrets como variáveis `VITE_*`.
3. Publica `dist/` no GitHub Pages.

Depois do primeiro push, abra **Settings → Pages** e em "Source" escolha
**GitHub Actions**. Pronto — o workflow cuida do resto.

### Secrets suportados (Settings → Secrets and variables → Actions)

Só um secret entra no bundle público: o PIN do gate, em texto puro. Todas
as outras credenciais (chave do Gemini, OAuth Client ID, Drive folder) são
cadastradas pelo próprio usuário dentro do app e ficam no SQLite local do
navegador — nunca vazam no JS servido pelo Pages.

| Nome                  | Obrigatório | Descrição |
|-----------------------|-------------|-----------|
| `VITE_APP_ACCESS_PIN` | recomendado | PIN de acesso em texto puro. Sem isto o site abre sem PIN. É visível no bundle público — trate como obstáculo leve, não como segurança forte. |

### Credenciais configuradas pelo app (não vão pro repositório)

Abra o app depois do deploy, digite o PIN e cadastre no próprio banco local:

| Onde cadastrar        | O quê                                                        |
|-----------------------|--------------------------------------------------------------|
| **Configurar IA**     | Chave do Google Gemini + modelo (`gemini-2.5-flash`, etc).   |
| **Sincronizar**       | OAuth Client ID do Google + ID da pasta raiz no Drive.       |

Esses valores ficam gravados na tabela `meta` do SQLite local e acompanham
o backup `.sqlite`. Importando o backup em outro navegador, as credenciais
vêm junto — é só não compartilhar o arquivo.

### Sobre o PIN

O valor de `VITE_APP_ACCESS_PIN` vai direto pro bundle JS público. Qualquer
pessoa com DevTools consegue lê-lo. Use o PIN como *gate* simples pra evitar
acesso casual, não como mecanismo de segurança sério.

A sessão é guardada no `sessionStorage` e dura enquanto a aba/janela fica
aberta — fechar o navegador obriga a digitar o PIN de novo.

## Segurança local

- Nunca commite `.env`, `*.sqlite`, `*.db` ou CSVs de extrato reais — o
  `.gitignore` já previne isso, mas sempre rode `git status` antes do primeiro
  commit.
- O botão "Exportar cópia .sqlite" (sidebar e tela Sincronizar) salva **todas**
  as tabelas do banco local. Guarde esse arquivo como backup seguro.
- Pra restaurar, use "Sincronizar → Backup do banco → Restaurar de arquivo
  .sqlite". Isso sobrescreve o estado atual do navegador.
