# ALT BURGUER · Gestão interna · Fase 1

Base do sistema: login, perfis (Sócio, Gerente, Funcionário), gestão de usuários, histórico de alterações e regras de segurança. Tudo roda no plano gratuito do Firebase, hospedado no GitHub Pages.

Os nomes exatos de botões e menus no console do Firebase podem mudar um pouco com o tempo. Se algo não bater, procure o item equivalente.

## 1. Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com e entre com sua conta Google.
2. Clique em **Criar projeto** e dê o nome (ex.: `alt-burguer`). O Google Analytics pode ficar desligado.
3. No menu **Build (Criação)**, abra **Authentication** > **Começar** > aba **Método de login** > ative **E-mail/senha**.
4. No menu **Build**, abra **Firestore Database** > **Criar banco de dados**.
   - Escolha o modo **produção**.
   - Escolha a região **southamerica-east1 (São Paulo)**. Atenção: a região não pode ser mudada depois.
5. Fique no plano gratuito (**Spark**). Não é preciso cadastrar cartão para esta fase.

## 2. Registrar o app web e colar as chaves

1. Na página inicial do projeto, clique no ícone **Web (`</>`)** e registre um app (ex.: `alt-web`). Não marque Firebase Hosting.
2. Copie o bloco `firebaseConfig` que aparece.
3. Abra o arquivo `js/firebase-config.js` e substitua os valores `COLE_AQUI` pelos seus.

Essas chaves não são segredo. Quem protege os dados são as regras do passo seguinte.

## 3. Publicar as regras de segurança

1. No **Firestore Database**, abra a aba **Regras**.
2. Apague o conteúdo e cole o arquivo `firestore.rules` inteiro.
3. Clique em **Publicar**.

## 4. Criar o primeiro sócio (manual, só uma vez)

1. Em **Authentication** > **Usuários** > **Adicionar usuário**, crie o login do primeiro sócio (e-mail e senha). Copie o **UID** dele (aparece na lista).
2. No **Firestore Database** > **Dados**, clique em **Iniciar coleção**:
   - ID da coleção: `usuarios`
   - ID do documento: cole o **UID** copiado
   - Campos:
     - `nome` (string): ex. `Davi`
     - `email` (string): o mesmo e-mail do login
     - `papel` (string): `admin`
     - `ativo` (boolean): `true`
3. Os demais usuários (o outro sócio, o gerente e os funcionários) você cria depois pela própria tela **Usuários** do sistema.

## 5. Testar no computador

Os módulos JavaScript não funcionam abrindo o arquivo direto (`file://`). Use um servidor local:

- **VS Code:** instale a extensão **Live Server**, clique com o botão direito em `index.html` > **Open with Live Server**.
- **Ou, com Python instalado:** na pasta do projeto, rode `python -m http.server 8000` e abra http://localhost:8000.

Se o login der erro de domínio, vá em **Authentication** > **Configurações** > **Domínios autorizados** e confirme que `localhost` está na lista.

## 6. Publicar no GitHub Pages

1. Crie uma conta em https://github.com (se ainda não tiver) e um repositório novo, ex.: `alt-burguer`.
2. Envie todos os arquivos desta pasta para o repositório (botão **Add file** > **Upload files**, ou `git push`).
3. No repositório, abra **Settings** > **Pages**. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
4. Em alguns minutos o site fica em `https://SEU-USUARIO.github.io/alt-burguer/`.
5. **Importante:** volte ao Firebase em **Authentication** > **Configurações** > **Domínios autorizados** > **Adicionar domínio** e inclua `SEU-USUARIO.github.io`. Sem isso o login não funciona no site publicado.

Atenção: repositórios gratuitos no GitHub Pages costumam ser públicos. O código e as chaves do passo 2 ficam visíveis, o que é esperado. Nunca coloque senhas ou dados reais da empresa dentro dos arquivos.

## 7. Checklist de testes antes de usar de verdade

- [ ] Entrar com o primeiro sócio funciona e abre o **Início**.
- [ ] Em **Usuários**, criar o segundo sócio, o gerente e um funcionário.
- [ ] Sair e entrar como **funcionário**: o menu mostra só **Início**; abrir `#/usuarios` na barra de endereço mostra "sem acesso".
- [ ] Desativar o funcionário e tentar entrar: aparece "Seu acesso não está ativo".
- [ ] Tentar desativar a si mesmo: o botão fica bloqueado.
- [ ] "Esqueci minha senha" envia o e-mail (olhe também o spam).
- [ ] Em **Firestore** > coleção `auditoria`, aparecem os registros das ações acima.

## Estrutura

```
index.html            login
app.html              painel (menu e área de conteúdo)
css/app.css           estilos
js/firebase-config.js suas chaves
js/firebase.js        conexão com o Firebase
js/auth.js            login, sessão, perfil
js/app.js             rotas e menu por perfil
js/util.js            utilitários e histórico de alterações
js/modules/           uma pasta de módulo por fase (inicio, usuarios...)
firestore.rules       regras de segurança
```

## Limitações conhecidas desta fase

- Desativar um usuário bloqueia o acesso ao sistema e aos dados, mas o login continua existindo no Firebase (o plano gratuito não tem servidor para apagá-lo).
- O Tailwind está via CDN, prático para começar. Mais para frente podemos gerar um CSS estático para ficar mais leve.
- As regras crescem a cada fase. Sempre que eu enviar um `firestore.rules` novo, publique-o de novo no console.
