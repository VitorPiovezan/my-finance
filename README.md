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

Todas são opcionais a menos que você queira a funcionalidade correspondente.
Como VITE_* vai pro bundle público, os valores podem ser inspecionados no
DevTools de qualquer visitante. Trate-os como "semi-públicos" e restrinja no
provedor (domínios autorizados, quotas, etc).

| Nome                                  | Obrigatório | Descrição |
|---------------------------------------|-------------|-----------|
| `VITE_APP_ACCESS_PIN_SHA256`          | recomendado | Hash SHA-256 (hex, 64 chars) do PIN de acesso. Veja abaixo como gerar. Sem isto, o site abre sem PIN. |
| `VITE_GOOGLE_OAUTH_CLIENT_ID`         | opcional    | OAuth Client ID (Web) pra ler a pasta do Drive. Restrinja as Authorized JavaScript origins pro seu domínio do Pages. |
| `VITE_DRIVE_FINANCE_ROOT_FOLDER_ID`   | opcional    | ID da pasta raiz no Drive. Também pode ser salvo direto no app. |
| `VITE_GEMINI_API_KEY`                 | **evite**   | Chave Gemini pra categorização automática. **Prefira deixar em branco** e cadastrar a chave na tela "Configurar IA" — ela fica só no localStorage do seu navegador, não vaza no bundle. |
| `VITE_GEMINI_MODEL`                   | opcional    | Ex.: `gemini-2.5-flash`. Pode ser sobrescrito no app. |

### Gerando o hash do PIN

O PIN em si não fica no bundle — só o hash. Gere o SHA-256 de uma das formas:

```bash
echo -n "MEU_PIN" | sha256sum
# ou
node -e "console.log(require('crypto').createHash('sha256').update('MEU_PIN').digest('hex'))"
```

Copie os 64 caracteres hex e cole em `VITE_APP_ACCESS_PIN_SHA256`.

**Avisos**: `VITE_*` são embarcados no JS público. Com o hash, o PIN em texto
puro não aparece, mas PIN curto (ex.: 4 dígitos numéricos) é trivial de
quebrar por brute-force offline. Use algo com tamanho e charset decente
(ex.: `7Fm9qK42` ou maior) se isso te preocupa.

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
