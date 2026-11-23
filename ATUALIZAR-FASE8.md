# ALT BURGUER · Fase 8: Tarefas por pessoa, Rotinas, Prejuízos, Nota fiscal, Conferência e Fotos no Drive

## O que mudou
**1. Tarefas**
- A tarefa **só pode ir para "Concluído" quando todas as etapas do checklist estiverem marcadas**. O botão mostra "Faltam N etapas". Desmarcar uma etapa de tarefa concluída a devolve para "Em andamento".
- **Cada pessoa vê só as tarefas atribuídas a ela** (funcionários e gerente). **Sócios veem todas.** Quem cria e atribui são os sócios, escolhendo uma ou mais pessoas.
- Para os sócios: **cada sócio tem uma cor** (laranja e charcoal), as tarefas **suas** ficam com a borda laranja e a etiqueta "Minha", e há filtro por pessoa. As tarefas antigas (que tinham só um nome) são vinculadas às pessoas automaticamente na primeira vez que um sócio abre a tela.
- Funcionários e gerente passam a ter o menu **Tarefas** (só com as deles).

**2. Rotinas (checklist do dia) e Prejuízos** (menu **Rotinas**)
- Os **sócios criam rotinas**: todo dia, em dias da semana, uma vez por mês ou **a cada N dias (ex.: auditoria de estoque de 15 em 15 dias)**. Escolhem para quem é (todos os funcionários, gerente ou pessoas específicas) e os itens. Há **modelos prontos**: abertura, fechamento e auditoria de estoque.
- Itens podem **exigir foto** (escreva `[foto]` no começo da linha). Ao marcar, a câmera abre e a foto sai com **data e hora gravadas na imagem** e fica no Google Drive.
- O funcionário abre **"Meu dia"** e marca o que fez. Rotina de "a cada N dias" aparece quando vence e fica **vermelha se atrasar**.
- Sócios e gerente têm o **Acompanhamento** do dia (quem fez o quê) e os sócios têm o **Histórico** dos últimos 30 dias, com links das fotos.
- **Prejuízos:** o funcionário pode **reportar** (perda de comida, quebra, erro, devolução, dinheiro), com descrição, insumo e quantidade (e **dar baixa no estoque como descarte** na hora) e foto. Ou avisar **"Hoje não houve prejuízo"**. Sócios e gerente veem os relatos e **quem ainda não respondeu hoje**; o **valor em R$ só o sócio define**.

**3. Nota fiscal (XML) e conferência do estoque**
- Em **Estoque > Compra rápida**, o botão **"Importar XML da nota (NF-e)"** lê a nota e preenche a compra: data, fornecedor, itens, quantidades e valores. Cada item é ligado a um insumo **pelo código de barras, pelo código do fornecedor (o sistema aprende) ou pelo nome parecido** (esse último vem marcado "confira"). Kg e litros viram as embalagens certas. Avisa se a nota já foi lançada antes.
- Ao salvar a compra, o estoque sobe como antes, mas ela fica **aguardando conferência**.
- Nova aba **Estoque > Recebimentos**: quem **não fez a compra** confere o que realmente chegou (**sem ver preços**), ajusta a quantidade se veio menos, informa a **validade** de cada item, tira foto (opcional) e marca **"Conferi"**. O resultado fica como **"Tudo certo"** ou **"Com divergência"**. Quem comprou **não pode conferir a própria compra**.
- **Quem confere:** o gerente e os funcionários marcados como **"Conferente"** (em **Usuários > Tornar conferente**). Os sócios também podem, desde que não tenham feito a compra.
- O Início mostra **"N compras aguardando conferência"** para quem confere.

**4. Fotos direto da câmera, guardadas no Google Drive**
- **Patrimônio:** botões **"Tirar foto"** e **"Escolher da galeria"** (a foto entra sozinha na lista). O campo de links continua funcionando.
- **Contagem de estoque (auditoria):** a **foto do estoque é exigida**, com data e hora na imagem. **Toda contagem fica registrada** ("Últimas contagens"), mesmo quando confere.
- Também usadas em rotinas, prejuízos e conferência.

## ⚙️ Configuração obrigatória: envio de fotos ao Drive (uma vez, ~10 minutos)
Um site não grava direto no Google Drive. Por isso criamos um **pequeno script do Google** na conta de vocês: o sistema manda a foto para ele, e ele guarda numa pasta do Drive ("ALT BURGUER - Fotos"). Use a conta Google que vai **ser a dona das fotos**.
1. Acesse **script.google.com** > **Novo projeto**. Apague o conteúdo e cole o arquivo **`apps-script/Code.gs`**.
2. Nas duas primeiras linhas, troque `COLE_AQUI...` pelo **apiKey** e pelo **projectId** do seu `js/firebase-config.js`.
3. Clique em **Salvar**. No seletor de funções, escolha **`autorizar`** e clique em **Executar**. Aceite as permissões (Drive e acesso externo). Se aparecer "app não verificado", vá em *Avançado > Acessar (não seguro)*: o script é seu.
4. **Implantar > Nova implantação > Tipo: Aplicativo da Web.** Em *Executar como*: **Eu**. Em *Quem pode acessar*: **Qualquer pessoa**. Clique em **Implantar** e **copie o URL** (termina em `/exec`).
5. Abra **`js/drive-config.js`** e troque `COLE_AQUI_A_URL_DO_APPS_SCRIPT` pelo URL copiado.
6. Se mudar o código do script depois, use **Implantar > Gerenciar implantações > Editar > Nova versão**.

Como fica seguro: o script só aceita foto de quem **está logado no sistema e com cadastro ativo** (ele confere no Firebase). Quem não for da equipe é recusado.
Observação: as fotos ficam como **"qualquer pessoa com o link"** (é o que permite mostrar a miniatura no sistema). Quem tiver o link consegue ver a foto; use só para fotos de equipamentos, estoque e rotina.
Dica: no Firebase, em **Authentication > Configurações**, desative a **criação de novas contas** se a opção existir, para ninguém de fora conseguir criar login.
Enquanto o endereço não for configurado, o sistema avisa e **não bloqueia o trabalho**: na contagem e nas rotinas ele pergunta se pode registrar sem foto.

## Como atualizar
1. Na pasta `alt-burguer`, **substitua**: `css/app.css`, `js/app.js`, `js/core/equipe.js`, `js/modules/tarefas.js`, `js/modules/estoque.js`, `js/modules/patrimonio.js`, `js/modules/usuarios.js`, `js/modules/inicio.js` e `firestore.rules`.
2. **Adicione**: `js/modules/rotinas.js`, `js/core/foto.js`, `js/core/rotinas.js`, `js/core/nfe.js`, `js/drive-config.js` e a pasta `apps-script`.
3. **Não substitua o `js/firebase-config.js`** (e, depois de configurado, também não o `js/drive-config.js`).
4. **Publique as regras:** Firestore Database > Regras > cole o novo `firestore.rules` > Publicar.
5. Faça a **configuração do Drive** acima, envie ao GitHub e atualize com Ctrl + F5.

Atenção: depois de publicar as regras, **funcionário e gerente deixam de ver tarefas que não sejam deles** (é o pedido). Tarefas antigas só aparecem para eles depois que um sócio abrir a tela de Tarefas (a migração vincula as pessoas).

## Primeiro uso
1. Sócio: abra **Tarefas** (a migração roda sozinha) e confira as tarefas marcadas "Sem responsável".
2. Sócio: **Usuários > Tornar conferente** para o estoquista.
3. Sócio: **Rotinas > Rotinas > Nova rotina**: crie abertura, fechamento e a **auditoria de estoque a cada 15 dias**.
4. Faça a configuração do Drive e teste uma foto.

## Checklist de testes
**Tarefas**
- [ ] Como sócio: criar tarefa com 3 etapas para o funcionário X. Como X: ela aparece; tarefas dos outros não.
- [ ] Como X: o botão fica **"Faltam 3 etapas"**; marcar as 3 libera o "Avançar" até Concluído.
- [ ] Desmarcar uma etapa de tarefa concluída: ela volta para Em andamento.
- [ ] Como sócio: as tarefas de cada sócio têm cor própria; as suas ficam com a borda laranja.
**Rotinas e prejuízos**
- [ ] Criar a rotina de abertura (todos os dias, para todos os funcionários): aparece em "Meu dia" do funcionário.
- [ ] Criar "auditoria a cada 15 dias" com item `[foto]`: ao marcar o item, a câmera abre e o link da foto aparece no histórico.
- [ ] Concluir todos os itens: a rotina vira "Concluída" e aparece como concluída no Acompanhamento.
- [ ] Funcionário: **Reportar prejuízo** com insumo e quantidade, marcando "dar baixa": o estoque diminui como descarte. **Hoje não houve prejuízo** registra o aviso.
- [ ] Sócio/gerente: veem os relatos e quem ainda não respondeu; só o sócio consegue definir o valor.
**Nota fiscal e conferência**
- [ ] Sócio: **Importar XML** de uma nota real: itens preenchidos; os que casaram mostram o motivo; os sem insumo pedem escolha.
- [ ] Importar a mesma nota de novo: o sistema avisa que já foi lançada.
- [ ] Salvar a compra: aparece em **Recebimentos** como pendente; quem comprou **não** consegue conferir.
- [ ] Gerente ou conferente: conferir informando validade; reduzir uma quantidade gera "Com divergência" e ajusta o estoque.
- [ ] Quem confere **não vê preços** em nenhum lugar dessa tela.
**Fotos**
- [ ] Patrimônio > Novo bem > **Tirar foto**: a foto aparece no Drive (pasta "ALT BURGUER - Fotos > Patrimonio") e a miniatura no sistema.
- [ ] Contagem de estoque sem foto: o sistema pede a foto. Com foto: data e hora aparecem na imagem.
- [ ] Alguém sem login (ou desativado) tentando usar o endereço do script: recusado.

## Limitações (sem servidor próprio, plano gratuito)
- **Trava do checklist** é feita pela tela. As regras garantem que cada pessoa só mexe nas próprias tarefas, mas não conseguem conferir etapa por etapa; quem tivesse conhecimento técnico poderia concluir sem marcar tudo.
- **Data e hora na foto** vêm do relógio do celular. O registro no sistema usa a hora do servidor, então dá para comparar, mas a foto em si poderia ser feita com o relógio alterado.
- **Nota fiscal:** funciona com o **arquivo XML** da NF-e (o fornecedor envia por e-mail, ou o contador/aplicativo de notas baixa). Não é possível ler a nota só pela foto ou pelo QR do cupom (NFC-e), porque o governo bloqueia essa consulta para sites. Se não houver XML, use a compra manual.
- **Conferência:** a conferência nunca **aumenta** o estoque (se vier mais do que o esperado, o sistema marca "divergência" e um sócio ajusta pela Contagem). E o estoque da compra já sobe antes da conferência; se a mercadoria ainda não chegou, a quantidade aparece no sistema mesmo assim.
- **Drive:** o limite é o espaço da conta Google (15 GB grátis) e as cotas do Apps Script, bem acima do uso de uma hamburgueria.
