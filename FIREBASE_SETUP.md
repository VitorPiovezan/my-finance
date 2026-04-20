# Firebase para login por e-mail + Firestore

O app usa **Firebase Authentication** (link por e-mail) para confirmar que quem cadastra Client ID + pasta raiz é dono do e-mail, e **Cloud Firestore** para guardar `drive_user_configs/{email}` (campos `clientId`, `driveRootFolderId`).

## 1. Criar projeto e app Web

1. [Console Firebase](https://console.firebase.google.com/) → Adicionar projeto.
2. Project settings → Seus apps → Web (`</>`) → registre o app e copie os valores para variáveis de ambiente (veja `.env.example`).

## 2. Authentication

1. **Build** → Authentication → Começar.
2. Aba **Sign-in method** → habilite **E-mail/senha** (na prática usamos **link por e-mail**; o provedor “E-mail” cobre o fluxo de link).
3. Aba **Settings** → **Authorized domains**: inclua `127.0.0.1` (dev), o host do GitHub Pages (`vitorpiovezan.github.io`) e, se usar **domínio próprio**, também `vitorpiovezan.com.br`.

## 3. Firestore

1. **Build** → Firestore Database → Criar banco (modo **produção** ou teste com regras abaixo).
2. **Regras** → cole o conteúdo de `firestore.rules` deste repositório e **publique**.

## 4. Variáveis no deploy (GitHub Actions / Pages)

No repositório GitHub → **Settings → Secrets and variables → Actions**, crie segredos com os mesmos nomes usados em `.github/workflows/deploy.yml` (por exemplo `VITE_FIREBASE_API_KEY`, …). Valores vazios deixam o gate de login desligado.

Defina os segredos ou variáveis de ambiente de build com o prefixo `VITE_` (o front lê em tempo de build):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN` (ex.: `seu-projeto.firebaseapp.com`)
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET` (pode vir vazio em alguns projetos; se existir no console, use o valor mostrado)
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Sem essas variáveis o app **não** ativa o gate de login; o comportamento antigo (Sincronizar + SQLite) continua disponível.

## 5. Link mágico (e-mail)

O link enviado pelo Firebase deve abrir a **URL base** do app (a que aparece na barra do navegador ao abrir o My Finance), por exemplo:

- GitHub Pages: `https://vitorpiovezan.github.io/my-finance/`
- Domínio próprio (mesmo site, outro host): `https://vitorpiovezan.com.br/my-finance/`

O app calcula essa base em tempo de execução (`window.location` + `BASE_URL` do Vite), então o build **não** precisa de variável extra para o domínio — basta o utilizador abrir o link no mesmo site em que fez o cadastro.

Em **Authentication → Templates de e-mail**, verifique se o domínio do link está entre os **Authorized domains**.

## 6. OAuth do **Drive** (Google Cloud Console)

Isso é **independente** do Firebase: cada utilizador cria um **OAuth 2.0 Client ID (Web)** para a API do Drive. Nas credenciais, inclua os mesmos valores que a página **Primeiro acesso** mostra para o ambiente onde corre o app, por exemplo:

| Onde corre | Origem JavaScript autorizada | URI de redirecionamento (base do app) |
|------------|------------------------------|--------------------------------------|
| GitHub Pages | `https://vitorpiovezan.github.io` | `https://vitorpiovezan.github.io/my-finance/` |
| Domínio próprio | `https://vitorpiovezan.com.br` | `https://vitorpiovezan.com.br/my-finance/` |

Pode ter **as duas** linhas ao mesmo tempo no mesmo Client ID (útil para testar em `*.github.io` e em produção no domínio). Modo de teste do OAuth: adicione o e-mail em **Usuários de teste** e espere alguns minutos após gravar.

## 6b. Domínio personalizado `vitorpiovezan.com.br` + GitHub Pages (checklist)

O repositório já faz build com `VITE_BASE_PATH=/my-finance/` no workflow (ficheiro `.github/workflows/deploy.yml`). Não é preciso alterar o outro projeto na raiz do domínio só para o My Finance “existir” em `/my-finance/`.

**No GitHub (repo `my-finance`):**

1. **Settings → Pages** → **Build and deployment** → origem **GitHub Actions** (o workflow já está no repo).
2. Depois de um deploy com sucesso, o site público fica em `https://vitorpiovezan.github.io/my-finance/`. Com domínio configurado na conta, o mesmo conteúdo costuma estar em `https://vitorpiovezan.com.br/my-finance/` (mesmo repositório de utilizador `username.github.io` + project site).

**No Firebase** (secção 2): domínio autorizado `vitorpiovezan.com.br`.

**No Google Cloud** (secção 6): origem `https://vitorpiovezan.com.br` e redirect `https://vitorpiovezan.com.br/my-finance/` (além dos de `github.io` se quiseres manter os dois).

**Deploy combinado (portfólio + My Finance no mesmo domínio):** o repositório [`portfolio`](https://github.com/VitorPiovezan/portfolio) tem um workflow que embute o build do `my-finance` em `/my-finance/`. Os secrets `VITE_FIREBASE_*` têm de existir **também** nas Actions do `portfolio`, não só no `my-finance`.

## 7. Desenvolvimento local

- Opção A: preencha `VITE_FIREBASE_*` num `.env` local.
- Opção B: defina `VITE_DISABLE_GOOGLE_GATE=1` para ignorar o gate e usar só a tela **Sincronizar** como antes.
