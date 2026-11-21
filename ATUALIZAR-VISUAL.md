# ALT BURGUER · Atualização visual (identidade + celular)

Nenhuma função mudou: é só o visual e o layout. Seus dados e as regras do Firebase continuam iguais (**não precisa publicar regras**).

## O que mudou
- **Identidade visual:** cores exatas da sua paleta (Charcoal `#272928`, Off White `#F4F1E6` e Security Orange `#EA681D`, tiradas da imagem). Fundo off white com textura leve de papel, menus em charcoal, laranja nos destaques. Títulos em fonte condensada pesada (Anton, parecida com a "ALT SANS") e textos em Archivo (parecida com a "URBAN SANS"). Cartões e botões com contorno e sombra dura, no estilo adesivo.
- **Logo:** empilhado (ALT grande, BURGUER embaixo) no login e no menu, e ícone laranja "ALT" na aba do navegador.
- **Menos espremido:** textos maiores, mais respiro entre os blocos, campos e botões grandes para o dedo (mínimo de 46 px).
- **Celular primeiro:**
  - Barra inferior fixa com as áreas principais e o botão **Mais**, que abre o menu completo. O círculo laranja no topo também abre o menu e o botão Sair.
  - As **tabelas viram cartões** (cada linha vira um cartão com os campos rotulados), sem rolar para o lado.
  - Janelas de cadastro sobem de baixo como folha.
  - O quadro de **tarefas desliza para o lado**, uma coluna por vez.
  - Filtros ocupam a largura toda; campos com 16 px, para o iPhone não dar zoom ao digitar.
- **No computador:** menu lateral fixo charcoal, título da página com sublinhado laranja (como no seu logo secundário) e área de conteúdo mais larga.
- **Impressão/PDF:** continua limpa e sem o menu.

## Como atualizar
Substitua na pasta `alt-burguer` (e adicione a pasta nova `assets`):
- `index.html`, `app.html`
- `css/app.css`
- `assets/favicon.svg` (novo)
- `js/app.js`
- todos os arquivos de `js/modules/` (`inicio`, `tarefas`, `fornecedores`, `patrimonio`, `financeiro`, `societario`, `usuarios`)

**Não substitua o `js/firebase-config.js`.** Depois, envie ao GitHub e atualize com **Ctrl + F5** (no celular, feche e abra a aba, ou limpe o cache).

## Checklist (teste no celular E no computador)
- [ ] Login: logo, campos grandes, mensagem de erro legível.
- [ ] Celular: barra inferior aparece, "Mais" abre o menu, o círculo do topo abre o menu, "Sair" funciona.
- [ ] Celular: tabelas (Usuários, Lançamentos, Patrimônio, Fornecedores) viram cartões legíveis.
- [ ] Celular: Tarefas desliza lateralmente entre as 3 colunas.
- [ ] Celular: abrir "Novo lançamento" ou "Novo bem": a janela sobe de baixo e dá para rolar até o botão Salvar.
- [ ] Computador: menu lateral, título com sublinhado laranja, tabelas normais.
- [ ] Textos legíveis (nada cinza claro demais) e nada cortado nas bordas (inclusive em iPhone com "notch").
- [ ] Imprimir um relatório do Financeiro sai limpo.

## Pontos para você decidir
- **Grafia da marca:** a imagem diz **ALT BURGER**, e o sistema, o domínio e as conversas usam **ALT BURGUER**. Mantive BURGUER. Se o correto for BURGER, avise que eu troco em um minuto.
- **Logo oficial:** montei o logo com a mesma proporção e fonte condensada, mas não é o arquivo original. Se tiver o logo em **SVG ou PNG com fundo transparente** (e o carimbo do hambúrguer), envie e eu coloco no lugar.
- **Fontes oficiais:** se tiver os arquivos da "ALT SANS" e da "URBAN SANS", eu uso no lugar das parecidas.
