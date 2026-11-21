# ALT BURGUER · Fase 5: Estoque (+ correção das janelas no celular)

## Correção no celular (a que você apontou)
As janelas de cadastro ("Novo lançamento" e as outras) estavam sem margem interna, com o campo de data invadindo o de valor e o botão Salvar cortado. Agora:
- as janelas têm margem interna correta e sobem de baixo como folha;
- **Cancelar e Salvar ficam fixos no rodapé** da janela, sempre visíveis mesmo com o formulário longo;
- o campo de data não invade mais o vizinho;
- a tela de trás não rola enquanto a janela está aberta.

## O que entra no Estoque
Menu **Estoque** (barra inferior no celular), com abas conforme o perfil:

| Aba | Sócios | Gerente | Funcionário |
|---|---|---|---|
| Insumos (estoque, mínimo, validade, lotes, etiqueta QR) | sim, com preços e cadastro | sim, **sem preços** | sim, **sem preços** |
| Compra rápida | sim | não | não |
| Baixa (saída para a cozinha) | sim | sim | sim |
| Contagem (inventário e ajuste) | sim | sim | não |
| Movimentações (quem, o quê, quanto, quando) | sim | sim | não |

- **Cadastro de insumos:** nome, categoria, unidade (g, ml ou un), quantidade por embalagem, preço da embalagem, estoque mínimo, código de barras de fábrica (opcional), estoque inicial com validade. O **custo por g/ml/un** é calculado sozinho.
- **QR code gerado pelo sistema** para cada insumo, com **etiqueta imprimível** (uma ou todas de uma vez). Também funciona com o código de barras de fábrica.
- **Compra rápida (celular):** escolha os insumos, informe embalagens, valor pago e validade. Ao salvar: o estoque sobe (cada compra vira um lote com validade), o **custo é atualizado** (último preço pago), o **histórico de preços** é registrado e, se marcado, a **despesa vai para o Financeiro** (caixa ou do bolso de um sócio).
- **Baixa (tablet ou celular):** botão **Ler QR / código de barras** pela câmera, ou escolha pelo nome. Pergunta a quantidade na unidade base e aceita "2 kg" ou "1,5 l". Sai **primeiro o lote que vence primeiro (PEPS)**. Há motivo "uso" ou "descarte/vencido/perda".
- **Alertas:** estoque abaixo do mínimo e lotes vencendo em 7 dias, na tela de Insumos e no Início.
- **Contagem:** informe o que realmente existe e o sistema corrige a diferença, registrando o ajuste.

**Fica para a Fase 6** (precisa das fichas técnicas): "Registrar produção" (sub-receitas virando estoque de preparos) e o recálculo automático do custo dos pratos quando o preço de um insumo muda.

## Como atualizar
1. Na pasta `alt-burguer`, **substitua**: `css/app.css`, `js/app.js`, `js/modules/inicio.js`, `firestore.rules`.
2. **Adicione**: `js/modules/estoque.js` e os arquivos novos de `js/core/` (`estoque-calc.js`, `estoque.js`, `scanner.js`, `etiquetas.js`, `scripts.js`).
3. **Não substitua o `js/firebase-config.js`.**
4. **Publique as regras:** Firestore Database > Regras > cole o novo `firestore.rules` > Publicar.
5. Envie ao GitHub e atualize com **Ctrl + F5** (no celular, feche e abra a aba).

## Primeiro uso (nesta ordem)
1. **Estoque > Insumos > Novo insumo:** cadastre os insumos com o estoque inicial e a validade.
2. Imprima as **etiquetas** ("Etiquetas de todos") e cole nas embalagens ou prateleiras. Para itens que já têm código de barras, basta digitá-lo no cadastro.
3. A partir daí, use **Compra rápida** nas compras e **Baixa** no dia a dia.

Observação: a leitura pela câmera e a geração do QR usam bibliotecas carregadas da internet (jsDelivr) na primeira vez que você usa. É preciso estar online. No celular o navegador vai pedir **permissão da câmera**: toque em Permitir.

## Checklist de testes
**Celular**
- [ ] Abrir "Novo lançamento" (Financeiro) e "Novo insumo": a janela sobe de baixo, sem cortar e sem campos sobrepostos; Cancelar e Salvar ficam fixos no rodapé.
- [ ] Cadastrar um insumo (ex.: Blend, g, embalagem 5000, R$ 165,00, mínimo 3000, estoque inicial 6000 com validade). O custo aparece como R$ 0,03/g.
- [ ] "Etiqueta" do insumo mostra o QR e imprime. Em "Etiquetas de todos" sai uma folha com todas.
- [ ] **Baixa:** tocar em "Ler QR", apontar para a etiqueta: o insumo é escolhido sozinho. Registrar saída de "2 kg": estoque cai 2000 g.
- [ ] Registrar uma saída maior que o estoque: o sistema recusa com mensagem clara.
- [ ] **Compra rápida** com 2 itens, "Lançar no Financeiro" marcado: estoque sobe, aparece despesa de categoria Insumos no Financeiro, e o histórico de preços do insumo ganha uma linha.
- [ ] **PEPS:** crie dois lotes do mesmo insumo com validades diferentes; a baixa tira primeiro do que vence antes ("Lotes" mostra a ordem).
- [ ] **Contagem:** informe uma quantidade diferente; a confirmação mostra a diferença e o estoque é corrigido. A aba Movimentações registra tudo.
- [ ] Deixar um insumo abaixo do mínimo: aparece "Baixo", e o Início mostra "Estoque abaixo do mínimo".

**Perfis (o teste que você ainda vai fazer)**
- [ ] **Gerente:** vê Insumos sem coluna de custo, Baixa, Contagem e Movimentações; **não** vê Compra rápida nem preços.
- [ ] **Funcionário:** vê só Insumos (sem preços) e Baixa.
- [ ] Gerente ou funcionário tentando abrir `#/financeiro` continuam sem acesso.

## O que as regras garantem (e o que não)
**Garantem:** preços e custos só os sócios leem (separados em outra coleção); funcionário e gerente só conseguem **diminuir** o saldo de um lote, nunca aumentá-lo; o funcionário só registra saídas; movimentações e compras não podem ser editadas nem apagadas; só sócios cadastram insumos.

**Não garantem:** a regra não consegue obrigar que toda baixa de lote venha acompanhada do registro na movimentação (o sistema sempre faz as duas coisas juntas, mas alguém com conhecimento técnico poderia mexer só no saldo). Para uma hamburgueria pequena isso é aceitável; a contagem periódica e o histórico ajudam a flagrar qualquer diferença.
