# Firebase para login por e-mail + Firestore

O app usa **Firebase Authentication** (link por e-mail) para confirmar que quem cadastra Client ID + pasta raiz é dono do e-mail, e **Cloud Firestore** para guardar `drive_user_configs/{email}` (campos `clientId`, `driveRootFolderId`).

## 1. Criar projeto e app Web

1. [Console Firebase](https://console.firebase.google.com/) → Adicionar projeto.
2. Project settings → Seus apps → Web (`</>`) → registre o app e copie os valores para variáveis de ambiente (veja `.env.example`).

## 2. Authentication

1. **Build** → Authentication → Começar.
2. Aba **Sign-in method** → habilite **E-mail/senha** (na prática usamos **link por e-mail**; o provedor “E-mail” cobre o fluxo de link).
3. Aba **Settings** → **Authorized domains**: inclua `127.0.0.1` (dev) e o host do GitHub Pages, por exemplo `vitorpiovezan.github.io`.

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

O link enviado pelo Firebase deve abrir a **URL base** do site (a mesma que você colocar em `VITE` / GitHub Pages), por exemplo:

`https://vitorpiovezan.github.io/my-finance/`

Em **Authentication → Templates de e-mail**, verifique se o domínio do link está entre os domínios autorizados.

## 6. OAuth do **Drive** (Google Cloud Console)

Isso é **independente** do Firebase: cada usuário cria um **OAuth 2.0 Client ID (Web)** para a API do Drive e coloca nas telas do app as origens/redirects que o próprio site mostra (origem `https://<user>.github.io` e base `https://<user>.github.io/my-finance/`). Modo de teste do OAuth: adicione o e-mail em **Usuários de teste** e espere alguns minutos após salvar.

## 7. Desenvolvimento local

- Opção A: preencha `VITE_FIREBASE_*` num `.env` local.
- Opção B: defina `VITE_DISABLE_GOOGLE_GATE=1` para ignorar o gate e usar só a tela **Sincronizar** como antes.
