# ALT BURGUER · Fase 3: Inventário inicial e Patrimônio

## O que entra
- **Patrimônio** (só sócios): cadastro dos equipamentos e utensílios com nome, marca/modelo, quantidade, estado de conservação, situação (em uso, guardado, em manutenção, baixado), localização, origem (já existia no imóvel, comprado, doado/emprestado), valor de mercado, valor de aquisição (quando souber), **valor atribuído ao inventário**, data de aquisição, observações e quem fez o levantamento.
- **Fotos:** até 10 links do Google Drive por bem, com miniatura quando o arquivo estiver compartilhado "qualquer pessoa com o link".
- **Histórico de cada bem:** mudanças de local e de situação são registradas sozinhas; manutenções (com custo opcional) entram pelo botão "Registrar manutenção".
- **Busca e filtros** por estado, situação e local, e **exportar CSV** do inventário.
- **Painel inicial:** novo indicador com o valor atribuído do patrimônio.

Os valores são sempre **por unidade**; o sistema multiplica pela quantidade nos totais.

## Como atualizar
1. Substitua na sua pasta `alt-burguer`:
   - `js/app.js`
   - `js/modules/inicio.js`
   - `js/modules/patrimonio.js` (novo)
   - `firestore.rules`
2. **Não substitua o `js/firebase-config.js`.**
3. No Firebase: **Firestore Database > Regras**, cole o novo `firestore.rules` e clique em **Publicar**.
4. Envie os arquivos ao GitHub do jeito que você já faz e atualize o site com **Ctrl + F5**.

## Como deixar as fotos visíveis
1. Crie uma pasta no Google Drive (ex.: "Inventário ALT BURGUER") e envie as fotos pelo celular.
2. Clique com o botão direito na foto > **Compartilhar** > **Acesso geral: Qualquer pessoa com o link**.
3. **Copiar link** e cole no campo de fotos do bem (um link por linha).
Atenção: quem tiver o link consegue ver a foto. Para fotos de equipamentos isso costuma ser aceitável; não use para documentos com dados pessoais.

## Checklist de testes
- [ ] O menu mostra **Patrimônio** (como sócio) e o gerente e o funcionário **não** veem.
- [ ] Cadastrar um bem com todos os campos e 1 foto do Drive: aparece na lista com a contagem de fotos.
- [ ] Abrir o bem: miniatura da foto, valores e histórico aparecem.
- [ ] Editar mudando o **local** e a **situação**: o histórico registra as duas mudanças.
- [ ] Registrar uma manutenção com custo: aparece no histórico.
- [ ] Filtrar por estado "Ruim" e buscar por nome.
- [ ] Exportar CSV e abrir no Excel (acentos e colunas corretos).
- [ ] No Início, o indicador "Patrimônio" soma o valor atribuído.
- [ ] Digitar `#/patrimonio` logado como gerente mostra "sem acesso".
