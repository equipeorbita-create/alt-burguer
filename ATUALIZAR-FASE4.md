# ALT BURGUER · Fase 4: Financeiro e Societário

Esta é a fase que mexe com dinheiro. **Teste tudo com valores fictícios antes de lançar dados reais**, e depois apague os lançamentos de teste.

## O que entra
**Financeiro** (só sócios)
- **Prestação de contas:** saldo em caixa, total emprestado pelos sócios, entradas/despesas/retiradas por período, resultado, despesas por categoria e a conta de cada sócio. Mostra também o equilíbrio entre os sócios em relação à divisão definida (referência).
- **Lançamentos:** despesa, entrada (com canal presencial ou delivery), retirada/pró-labore e empréstimo de sócio. Filtros por período, tipo, categoria e sócio; exportar CSV; imprimir / salvar em PDF. Comprovante por link opcional (ou envie pelo WhatsApp).
- **Configurações:** divisão societária (começa 50/50 e é editável), caixa inicial e categorias editáveis (criadas automaticamente na primeira vez).

**Societário** (só sócios)
- **Conta corrente** de cada sócio com extrato e saldo que a empresa deve devolver.
- **Reembolsos com aprovação dos dois sócios:** quem solicita já conta como uma aprovação; o outro sócio precisa aprovar separadamente. O pagamento só é registrado depois das duas aprovações, e **só então** o saldo do sócio diminui.
- **Histórico de alterações:** últimos 100 registros, que ninguém consegue editar ou apagar.

**Painel inicial:** saldo em caixa, total emprestado e reembolsos em aberto.

## Regras de cálculo
- **Caixa** = caixa inicial + empréstimos + entradas − despesas pagas pelo caixa − retiradas − reembolsos pagos.
- **Despesa paga do bolso de um sócio** não mexe no caixa: vira saldo a devolver a ele.
- **Saldo do sócio** = empréstimos + despesas pagas do bolso − reembolsos recebidos.
- Empréstimo não é capital social nem distribuição de lucros.

## Como atualizar
1. Na pasta `alt-burguer`, **substitua** `css/app.css`, `js/app.js`, `js/modules/inicio.js` e `firestore.rules`, e **adicione** `js/core/financas.js`, `js/modules/financeiro.js` e `js/modules/societario.js`.
2. **Não substitua o `js/firebase-config.js`.**
3. **Publique as regras novas:** Firestore Database > Regras > cole o `firestore.rules` > Publicar. Se o console mostrar erro de sintaxe, me mande a mensagem.
4. Envie ao GitHub do jeito que você já faz e atualize o site com **Ctrl + F5**.

## Primeiro uso (nesta ordem)
1. **Financeiro > Configurações:** confira a divisão (50/50) e informe o caixa inicial (0 se não houver).
2. Cadastre os **empréstimos dos sócios** como lançamentos do tipo "Empréstimo de sócio".
3. Cadastre despesas indicando "Quem pagou" (caixa ou o sócio que pagou do bolso).

## Checklist de testes (com dois logins de sócio: Davi e Eliabe)
- [ ] Criar um empréstimo de R$ 1.000 do Davi: caixa +1.000 e saldo do Davi 1.000.
- [ ] Criar uma despesa de R$ 200 paga pelo **caixa**: caixa 800, saldo do Davi igual.
- [ ] Criar uma despesa de R$ 100 paga pelo **bolso do Eliabe**: caixa não muda; saldo do Eliabe 100.
- [ ] Como Davi, solicitar reembolso de R$ 300 para ele mesmo: aparece "aguardando aprovação" com a aprovação dele já marcada.
- [ ] Como Davi, **não aparece** o botão Aprovar de novo para a mesma solicitação.
- [ ] Como Eliabe, aprovar: status vira "Aprovado pelos dois" e surge "Registrar pagamento".
- [ ] Registrar o pagamento: caixa cai R$ 300, saldo do Davi cai R$ 300 e surge o lançamento "Reembolso a Davi".
- [ ] Tentar pedir reembolso maior que o saldo do sócio: o sistema recusa.
- [ ] Tentar pagar reembolso maior que o caixa: o sistema recusa.
- [ ] Recusar uma solicitação: status "Recusado" e nada muda nos saldos.
- [ ] Filtrar lançamentos por período e por sócio; exportar CSV; imprimir (a tela sai limpa, sem menu).
- [ ] Societário > Histórico: aparecem as ações acima.
- [ ] Logado como gerente ou funcionário, `#/financeiro` e `#/societario` mostram "sem acesso".
- [ ] Excluir um lançamento de teste: some e fica registrado no histórico. Lançamentos de reembolso não têm botão de excluir.

## O que as regras do Firebase garantem (e o que não)
**Garantem:** só sócios acessam o financeiro; cada sócio só aprova pela própria conta e uma única vez; o pagamento só existe com as duas aprovações; um reembolso só vira lançamento junto com o pagamento correspondente; valor, tipo, data e sócio de um lançamento não podem ser alterados depois; o histórico de alterações não pode ser editado.

**Não garantem (limitação do plano gratuito, sem servidor próprio):** o limite de "saldo em caixa suficiente" e "não passar do saldo do sócio" é conferido pela tela, não pelas regras. Alguém com conhecimento técnico e login de sócio poderia contornar isso. Entre dois sócios de confiança isso é aceitável; se quiserem reforçar no futuro, dá para migrar essa validação para um servidor.

## Observações
- Se alterar a divisão societária depois, nada é recalculado nos saldos: a divisão só afeta a referência de equilíbrio.
- Excluir um empréstimo que já teve reembolso pode deixar o saldo do sócio negativo. Prefira corrigir por novo lançamento.
- Se houver mais de 2 sócios ativos (usuários "Sócio / Admin"), a divisão e o equilíbrio consideram todos.
