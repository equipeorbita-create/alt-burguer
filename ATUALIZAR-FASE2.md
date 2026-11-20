# ALT BURGUER · Fase 2: Painel, Tarefas e Fornecedores

## O que entra nesta fase
- **Início (painel):** tarefas em aberto, em andamento e atrasadas, pontos a melhorar, progresso da implantação e próximos prazos. Para sócios, também fornecedores, orçamentos sem escolha e total dos orçamentos escolhidos.
- **Tarefas:** quadro A fazer, Em andamento e Concluído, com responsável (Davi, Eliabe, Ambos ou Gerente), prazo, checklist e filtro de "Pontos a melhorar". Atualiza em tempo real para os dois sócios.
- **Fornecedores:** cadastro com link direto para o WhatsApp e comparação de orçamentos, com destaque para o menor preço e botão para escolher a proposta.

Quem vê o quê: sócios veem tudo; o gerente vê Tarefas e o painel (sem dados de fornecedores); o funcionário vê só o Início.

## Como atualizar (5 minutos)
1. Copie para dentro da sua pasta `alt-burguer`, **substituindo** os arquivos existentes:
   - `css/app.css`
   - `js/app.js`
   - `js/util.js`
   - `js/modules/inicio.js`
   - `js/modules/tarefas.js` (novo)
   - `js/modules/fornecedores.js` (novo)
   - `firestore.rules`
2. **NÃO substitua** o `js/firebase-config.js`: ele tem as suas chaves.
3. No Firebase, abra **Firestore Database > Regras**, cole o conteúdo novo de `firestore.rules` e clique em **Publicar**. Sem isso as telas novas dão "Sem permissão".
4. Atualize a página com **Ctrl + F5** (limpa o cache do navegador).
5. Se já publicou no GitHub Pages, envie os arquivos novos para o repositório.

Não é preciso criar índices nem mudar nada no console além das regras.

## Checklist de testes
- [ ] O menu mostra Início, Tarefas, Fornecedores e Usuários (como sócio).
- [ ] Criar uma tarefa com prazo e etapas; marcar uma etapa; avançar para "Em andamento".
- [ ] Criar uma tarefa com prazo no passado: aparece como **Atrasada** e entra no contador do Início.
- [ ] Criar um "Ponto a melhorar" e filtrar pela aba.
- [ ] Abrir o sistema em duas abas (ou dois aparelhos): a mudança em uma aparece na outra sem recarregar.
- [ ] Cadastrar 2 ou 3 fornecedores e criar orçamentos do mesmo item: o menor preço recebe a etiqueta e "Escolher" marca só um.
- [ ] Entrar como **gerente**: vê Tarefas, mas não Fornecedores. Digitar `#/fornecedores` na barra mostra "sem acesso".
- [ ] Entrar como **funcionário**: vê só o Início.
- [ ] Em Firestore > `auditoria` aparecem os registros (tarefa criada ou concluída, orçamento escolhido etc.).

## Observações
- Só sócios excluem tarefas.
- Excluir um fornecedor não apaga os orçamentos dele (o nome fica guardado em cada orçamento).
- Links de propostas aceitam só endereços que começam com http:// ou https:// (use o link de compartilhamento do Google Drive).
- Valores aceitam vírgula ou ponto: `4.200,00`, `4200,50` ou `4200.50`.
