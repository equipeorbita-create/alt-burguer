# ALT BURGUER · Fase 6: Cardápio, fichas técnicas, CMV, POPs e Modo Cozinha

## O que entra
Menu **Cardápio** (barra inferior no celular), com três abas:

**Cardápio (pratos)** e **Preparos (sub-receitas)**
- **Ficha técnica** com os ingredientes e a pesagem exata (g, ml ou un). Um ingrediente pode ser um **insumo** ou outro **preparo**: a Maionese entra no Molho Cheddar, que entra no prato, e o sistema impede que um preparo use a si mesmo.
- **Perda opcional por ingrediente** (aparas, cocção): o custo e a baixa de estoque usam a quantidade bruta; a cozinha vê "separar X g".
- **Preparo** tem rendimento (g ou ml), validade em dias e custo por grama.
- **Recálculo automático em cascata:** o custo não é gravado, é calculado na hora. Quando uma compra muda o preço de um insumo, os preparos e os pratos se atualizam sozinhos.
- **Só sócios veem:** custo, preço de venda, **CMV (%)**, **margem de contribuição (R$ e %)** e **preço sugerido** para a meta (com a versão arredondada em ,90). Aparece o aviso "custo incompleto" se algum insumo está sem preço.
- **Metas de CMV** (botão para sócios): meta padrão, meta por categoria (ex.: bebidas) e meta por item. Há também um percentual opcional de **taxas e impostos**, que entra só na margem real, sem mexer no CMV.
- **POP** em cada item: tempo, equipamentos, passo a passo e observações.
- **Modo Cozinha:** tela cheia escura com letras grandes. Multiplicador **×½ ×1 ×2 ×3 ×5** que recalcula as pesagens, toque para marcar pesagens e passos feitos, e a tela não apaga enquanto está aberto (nos aparelhos que permitem).
- **Duplicar** um item e **Buscar/filtrar por categoria**.

**Produção** (sócios e gerente) e **Preparos prontos** (funcionário)
- **Registrar produção:** baixa os ingredientes do estoque (PEPS) e cria o lote do preparo pronto, com validade e rendimento real, tudo de uma vez. Antes de confirmar, mostra o que será consumido e avisa o que falta.
- **Preparos prontos em estoque** com validade, e o botão **Usar / descartar** (todos os perfis).
- Os preparos prontos também entram nos alertas de lote vencendo.

## Quem vê o quê
| | Sócios | Gerente | Funcionário |
|---|---|---|---|
| Ver cardápio, fichas (pesagens) e POPs | sim | sim | sim |
| Modo Cozinha | sim | sim | sim |
| Criar e editar fichas e POPs | sim | sim | não |
| Custo, preço, CMV, margem | **sim** | não | não |
| Excluir itens | sim | não | não |
| Registrar produção | sim | sim | não |
| Usar/descartar preparos prontos | sim | sim | sim |

## Como atualizar
1. Na pasta `alt-burguer`, **substitua**: `css/app.css`, `js/app.js` e `firestore.rules`.
2. **Adicione**: `js/modules/cardapio.js`, `js/core/custos.js` e `js/core/producao.js`.
3. **Não substitua o `js/firebase-config.js`.**
4. **Publique as regras:** Firestore Database > Regras > cole o novo `firestore.rules` > Publicar.
5. Envie ao GitHub e atualize com Ctrl + F5 (no celular, feche e abra a aba).

## Primeiro uso (nesta ordem)
1. Estoque: confira se os **insumos** estão cadastrados com **preço** (sem preço o custo fica "incompleto").
2. **Cardápio > Preparos > Novo preparo:** cadastre Maionese, Molho Cheddar, Blend etc., com rendimento.
3. **Cardápio > Novo prato:** monte as fichas e informe o preço de venda.
4. **Metas de CMV:** defina a meta padrão (começa em 30%).
5. Preencha o passo a passo (POP) e teste o **Modo Cozinha** no tablet.

## Checklist de testes
- [ ] Criar o preparo "Maionese" (óleo + ovos) com rendimento 1000 g; o custo por grama aparece (como sócio).
- [ ] Criar "Molho Cheddar" usando a Maionese como ingrediente.
- [ ] Criar um prato usando insumos e os dois preparos, com preço de venda: custo, CMV, margem e preço sugerido aparecem.
- [ ] Tentar fazer a Maionese usar o Molho Cheddar: o sistema recusa ("não pode usar a si mesmo").
- [ ] **Recálculo:** em Estoque > Compra rápida, compre óleo por um preço maior: o custo da Maionese, do Molho e do prato sobe sozinho.
- [ ] Linha com perda 10%: o custo sobe e o Modo Cozinha mostra "separar X g".
- [ ] **Modo Cozinha** no tablet e no celular: letras grandes, multiplicador ×2 dobra as pesagens, tocar marca como feito.
- [ ] **Produção:** com estoque dos ingredientes, registrar 1 receita de Maionese: os ingredientes baixam e o preparo aparece em "Preparos prontos". Sem estoque suficiente, o sistema avisa o que falta e não registra nada.
- [ ] **Usar / descartar** parte da Maionese pronta: o estoque do preparo baixa.
- [ ] **Gerente:** vê as fichas e o POP, edita a ficha, registra produção, mas **não vê custo, preço, CMV nem margem**, nem o botão Metas.
- [ ] **Funcionário:** vê fichas, POPs e Modo Cozinha, não edita, não vê valores.
- [ ] Excluir um preparo que está em uso por um prato: o sistema bloqueia e diz onde ele é usado.
- [ ] No celular: o editor (janela longa) rola, e Cancelar/Salvar ficam fixos no rodapé.

## Limitações
- **Custos só para sócios** valem porque os preços dos insumos ficam em coleção restrita. Gerente e funcionário não conseguem calcular custo nem consultando o banco.
- O **gerente edita as quantidades das fichas**, o que muda o custo calculado. É de propósito (ele ajusta a ficha da cozinha), mas vale o sócio conferir o CMV de tempos em tempos. As edições ficam no histórico de alterações.
- **Tela cheia e tela sempre acesa** dependem do aparelho. No iPhone a tela cheia nativa pode não abrir, mas o Modo Cozinha já cobre a tela inteira do mesmo jeito.
- **Variações de tamanho** (simples/duplo) são fichas separadas, como combinado.
