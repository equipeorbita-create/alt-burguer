import { db } from "../firebase.js";
import { esc, PAPEIS, hojeISO, fmtDia, brl } from "../util.js";
import { resumo } from "../core/financas.js";
import { estoqueDe, diasAte } from "../core/estoque-calc.js";
import { collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const kpi = (rotulo, valor, dica = "") =>
  `<div class="card"><div class="text-ink/70 text-sm">${rotulo}</div>
   <div class="num mt-1">${valor}</div>
   ${dica ? `<div class="text-xs text-ink/70 mt-1">${dica}</div>` : ""}</div>`;

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  const topo = `<div class="card mb-4"><h2 class="h2">Olá, ${esc(perfil.nome.split(" ")[0])}!</h2>
    <p class="text-ink/70 mt-1">Você entrou como <b>${esc(PAPEIS[perfil.papel] || perfil.papel)}</b>.</p></div>`;

  if (perfil.papel === "funcionario") {
    el.innerHTML = topo + `<div class="card"><h2 class="h2">Em breve</h2>
      <p class="text-ink/70 mt-1">Aqui vão aparecer seus avisos, o manual do funcionário e o ponto.</p></div>`;
    return;
  }

  el.innerHTML = topo + `<p class="text-ink/70">Carregando indicadores…</p>`;
  const pegar = async (n) => (await getDocs(collection(db, n))).docs.map((d) => ({ id: d.id, ...d.data() }));
  let tar = [], forn = [], orc = [], pat = [], lan = [], reemb = [], cfg = {}, ins = [], lot = [];
  try {
    [tar, forn, orc, pat, lan, reemb, ins, lot] = await Promise.all([pegar("tarefas"), admin ? pegar("fornecedores") : [], admin ? pegar("orcamentos") : [], admin ? pegar("patrimonio") : [], admin ? pegar("lancamentos") : [], admin ? pegar("reembolsos") : [], pegar("insumos"),
      getDocs(query(collection(db, "lotes"), where("qtdAtual", ">", 0))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))]);
    if (admin) { const c = await getDoc(doc(db, "config", "geral")); cfg = c.exists() ? c.data() : {}; }
  } catch (e) {
    console.error(e);
    el.innerHTML = topo + `<div class="card">Não foi possível carregar os indicadores.</div>`;
    return;
  }

  const hoje = hojeISO();
  const baixos = ins.filter((i) => i.ativo !== false && estoqueDe(lot, i.id) < i.estoqueMinimo).length;
  const vencendo = lot.filter((l) => l.validade && diasAte(l.validade) <= 7).length;
  const abertas = tar.filter((t) => t.status !== "concluido");
  const atrasadas = abertas.filter((t) => t.prazo && t.prazo < hoje);
  const andamento = tar.filter((t) => t.status === "andamento");
  const melhorias = abertas.filter((t) => t.tipo === "melhoria");
  const impl = tar.filter((t) => t.tipo === "tarefa");
  const pct = impl.length ? Math.round((impl.filter((t) => t.status === "concluido").length / impl.length) * 100) : 0;
  const proximas = abertas.filter((t) => t.prazo).sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 6);

  let extra = "";
  if (admin) {
    const grupos = new Map();
    orc.forEach((o) => { const k = o.item.trim().toLowerCase(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(o); });
    const pend = [...grupos.values()].filter((g) => !g.some((o) => o.escolhido)).length;
    const total = orc.filter((o) => o.escolhido).reduce((s, o) => s + o.valor, 0);
    const rs = resumo(lan, cfg.caixaInicial || 0);
    extra = kpi("Saldo em caixa", brl(rs.caixa)) +
            kpi("Emprestado pelos sócios", brl(rs.devedorTotal), "saldo a devolver") +
            kpi("Reembolsos em aberto", reemb.filter((r) => r.status === "pendente" || r.status === "aprovado").length, "aguardando aprovação ou pagamento") +
            kpi("Fornecedores", forn.length) + kpi("Orçamentos sem escolha", pend, "itens aguardando decisão") +
            kpi("Total dos orçamentos escolhidos", brl(total)) +
            kpi("Patrimônio (valor atribuído)", brl(pat.reduce((t, b) => t + b.valorAtribuido * b.quantidade, 0)), `${pat.length} bens no inventário`);
  }

  el.innerHTML = topo + `
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
      ${kpi("Estoque abaixo do mínimo", baixos, baixos ? "veja em Estoque" : "tudo certo")}
      ${kpi("Lotes vencendo (7 dias)", vencendo, vencendo ? "use primeiro (PEPS)" : "nenhum")}
      ${kpi("Tarefas em aberto", abertas.length)}
      ${kpi("Em andamento", andamento.length)}
      ${kpi("Atrasadas", atrasadas.length, atrasadas.length ? "passaram do prazo" : "tudo em dia")}
      ${kpi("Pontos a melhorar", melhorias.length, "em aberto")}
      ${extra}
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card"><h2 class="h2 mb-2">Implantação</h2>
        <div class="h-3 rounded-full bg-ink/10 overflow-hidden"><div class="h-full bg-brand" style="width:${pct}%"></div></div>
        <p class="text-sm text-ink/70 mt-2">${pct}% concluído (${impl.filter((t) => t.status === "concluido").length} de ${impl.length} tarefas)</p>
      </div>
      <div class="card"><h2 class="h2 mb-2">Próximos prazos</h2>
        ${proximas.length ? `<ul class="space-y-1">${proximas.map((t) => `<li class="flex gap-3">
          <span class="tag ${t.prazo < hoje ? "bad" : ""}">${fmtDia(t.prazo)}</span><span>${esc(t.titulo)}</span>
          <span class="text-ink/70 text-sm">· ${esc(t.responsavel)}</span></li>`).join("")}</ul>`
          : '<p class="text-ink/70">Nenhuma tarefa com prazo.</p>'}
        <a class="underline text-brand-dark text-sm mt-3 inline-block" href="#/tarefas">Abrir tarefas</a>
      </div>
    </div>
`;
}
