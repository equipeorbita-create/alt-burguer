# ALT BURGUER · Fase 7: Portal, ponto, equipe e relatórios

## O que entra
**Portal** (menu "Portal", todos os perfis)
- **Alertas:** nível *urgente* ou *aviso*, com o botão **"Estou ciente"**. Sócios e gerente veem quantas pessoas já confirmaram e **quem ainda falta**. Alertas não confirmados também aparecem no **Início** de cada pessoa.
- **Notícias e comunicados.** Sócios e gerente publicam, editam e arquivam.
- **Manual do funcionário:** seções que abrem e fecham (boas-vindas, higiene, uniforme, ponto...), com ordem definida por você.
- **Ponto** (funcionários e gerente; sócios não batem ponto): relógio, botão grande com o **próximo registro** (entrada, início do intervalo, fim do intervalo, saída), situação atual, horas do mês e últimos dias. A hora vem do **servidor**, não do celular, então não dá para adiantar ou atrasar o relógio.
  - Turno que passa da meia-noite conta no dia em que começou.
  - Se alguém esquecer a saída, o sistema oferece iniciar um novo turno depois de 16 horas, e o turno antigo fica marcado como "incompleto" até ser ajustado.
  - **Esqueci de bater:** a pessoa pede o ajuste (dia, hora, tipo, justificativa); **outra pessoa aprova** antes de valer. O gerente aprova os pedidos dos funcionários; os do gerente só um sócio aprova.

**Equipe** (sócios e gerente)
- **Hoje:** quem está trabalhando, em intervalo, fora, ou com turno aberto há muito tempo.
- **Espelho de ponto** por mês e por funcionário, com total de horas, turnos incompletos e marca nos registros lançados por ajuste. Exporta **CSV** e imprime/PDF.
- **Ajustes:** aprovar ou recusar pedidos.
- **Funcionários:** ficha com cargo, telefone (link para WhatsApp), jornada e admissão. Só sócios editam.

**Relatórios** (só sócios, mês de referência editável, exporta CSV e imprime)
- **Financeiro:** entradas, despesas e resultado do mês, últimos 6 meses, despesas por categoria, entradas por canal (presencial e delivery) e saldo em caixa.
- **Cardápio e CMV:** pratos do pior CMV para o melhor, custo, preço, margem e preço sugerido.
- **Estoque:** valor em estoque, saídas do mês, **descartes e perdas em R$**, itens abaixo do mínimo e lotes vencendo.
- **Equipe:** horas por funcionário no mês, dias, média por dia e turnos incompletos.

**Celular:** a barra inferior agora mostra os atalhos de cada perfil. Sócios: Início, Estoque, Cardápio, Financeiro. Gerente e funcionário: Início, Portal, Estoque, Cardápio. O resto fica em "Mais".

## Quem vê o quê
| | Sócios | Gerente | Funcionário |
|---|---|---|---|
| Ver alertas, notícias e manual | sim | sim | sim |
| "Estou ciente" | não precisa | sim | sim |
| Publicar alertas, notícias e manual | sim | sim | não |
| Bater ponto | não | sim | sim |
| Ver o ponto de todos / Equipe | sim | sim (funcionários e ele mesmo) | só o próprio |
| Aprovar ajustes | todos | só de funcionários | não |
| Fichas dos funcionários | edita | só vê | não |
| Relatórios | sim | não | não |

## Como atualizar
1. Na pasta `alt-burguer`, **substitua**: `js/app.js`, `js/modules/inicio.js` e `firestore.rules`.
2. **Adicione**: `js/modules/portal.js`, `js/modules/equipe.js`, `js/modules/relatorios.js`, `js/core/ponto.js` e `js/core/equipe.js`.
3. **Não substitua o `js/firebase-config.js`.**
4. **Publique as regras:** Firestore Database > Regras > cole o novo `firestore.rules` > Publicar.
5. Envie ao GitHub e atualize com Ctrl + F5 (no celular, feche e abra a aba).

## Primeiro uso
1. **Usuários:** crie o login de cada funcionário (perfil Funcionário).
2. **Portal > Manual:** escreva as seções do manual.
3. **Equipe > Funcionários:** preencha as fichas.
4. Avise a equipe para entrar pelo celular e bater o ponto.

## Checklist de testes (use um login de gerente e dois de funcionário)
- [ ] Gerente publica um **alerta urgente**. Entrando como funcionário, ele aparece no **Início** e no Portal; tocar "Estou ciente" some do Início.
- [ ] Gerente vê "1 de N cientes" e o nome de quem ainda falta.
- [ ] Funcionário **não** vê botões de publicar nem a aba Equipe.
- [ ] **Ponto:** entrada, início do intervalo, fim do intervalo e saída, nessa ordem; o botão sempre oferece o próximo passo e não deixa registrar fora de ordem.
- [ ] Tocar duas vezes seguidas: o sistema avisa "acabou de registrar".
- [ ] Trocar a hora do celular para outra: o registro continua com a hora certa do servidor.
- [ ] **Equipe > Hoje** mostra o funcionário "Trabalhando", "Em intervalo" e "Fora" conforme o registro.
- [ ] **Espelho de ponto:** total de horas confere (ex.: 10h às 14h e 15h às 19h = 8h00). Exportar CSV abre no Excel com acentos corretos.
- [ ] **Esqueci de bater:** o funcionário pede um ajuste; o gerente aprova; o registro aparece com `*` e as horas se atualizam.
- [ ] O gerente **não** consegue aprovar o próprio pedido (aparece "precisa ser aprovado por um sócio"); o sócio consegue.
- [ ] Funcionário **não** consegue ler o ponto de outra pessoa, nem alterar um registro.
- [ ] **Relatórios** (sócio): os quatro relatórios carregam; mudar o mês atualiza; CSV e imprimir funcionam.
- [ ] No celular: a barra inferior mostra os atalhos certos de cada perfil, e o botão de bater ponto é grande e fácil de tocar.

## Limitações e cuidados
- **Valor legal do ponto:** este ponto é um **controle interno** da hamburgueria. Se vocês forem usá-lo como registro oficial de jornada, as regras do ponto eletrônico (Portaria 671/2021 do Ministério do Trabalho) podem exigir um sistema com requisitos específicos. Confirme com o contador antes de depender dele para fins trabalhistas.
- **Ordem dos registros:** o servidor garante a hora e que ninguém mexe em registro alheio; a **sequência** (entrada, intervalo, saída) é conferida pela tela. Alguém com conhecimento técnico poderia registrar fora de ordem, mas não consegue falsificar o horário.
- **Quem pode bater ponto de outro:** ninguém. Cada pessoa só registra o próprio.
- **Localização:** o sistema **não** coleta o local de onde o ponto foi batido. Qualquer celular com login consegue registrar. Se quiserem restringir à loja, dá para exigir um tablet fixo ou a localização do aparelho (nesse caso, é preciso avisar e obter o consentimento da equipe, por causa da LGPD).
- **Dados pessoais:** telefone, admissão e jornada ficam acessíveis só a sócios e gerente (e a própria pessoa). Mantenha só o necessário nas fichas.
