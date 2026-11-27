import { db } from "../firebase.js";
import { esc, PAPEIS, hojeISO, fmtDia, brl, toast } from "../util.js";
import { resumo } from "../core/financas.js";
import { carregarEntradas } from "../core/caixa-dados.js";
import { estoqueDe, diasAte } from "../core/estoque-calc.js";
import { collection, getDocs, doc, getDoc, query, where, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const kpi = (rotulo, valor, dica = "") =>
  `<div class="card"><div class="text-ink/70 text-sm">${rotulo}</div>
   <div class="num mt-1">${valor}</div>
   ${dica ? `<div class="text-xs text-ink/70 mt-1">${dica}</div>` : ""}</div>`;

// Alertas que a pessoa ainda não confirmou ("Estou ciente")
async function alertasPendentes(perfil) {
  try {
    const s = await getDocs(collection(db, "comunicados"));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.tipo === "alerta" && c.ativo !== false && !(c.cientes || []).includes(perfil.uid))
      .sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));
  } catch (e) { console.error(e); return []; }
}
const htmlAlertas = (l) => `<div id="alertasIni">${l.map((c) => `<div class="card mb-4" style="border-left:10px solid var(--orange)">
  <div class="flex items-start gap-3"><h3 class="h2 flex-1">${esc(c.titulo)}</h3><span class="tag ${c.nivel === "urgente" ? "bad" : ""}">${c.nivel === "urgente" ? "Urgente" : "Aviso"}</span></div>
  <p class="whitespace-pre-wrap mt-2">${esc(c.texto)}</p><button class="btn mt-3" data-ciente="${c.id}">Estou ciente</button></div>`).join("")}</div>`;
function ligarAlertas(el, perfil) {
  el.querySelector("#alertasIni")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ciente]");
    if (!b) return;
    b.disabled = true;
    try { await updateDoc(doc(db, "comunicados", b.dataset.ciente), { cientes: arrayUnion(perfil.uid) }); b.closest(".card").remove(); toast("Ciência registrada."); }
    catch (err) { console.error(err); b.disabled = false; toast("Não foi possível registrar. Tente de novo."); }
  });
}
const atalhos = `<div class="grid gap-4 sm:grid-cols-2"><a class="card block" href="#/rotinas"><h3 class="h2">Meu dia</h3><p class="text-ink/70 mt-1">Checklist de hoje e relato de prejuízos.</p></a>
  <a class="card block" href="#/portal"><h3 class="h2">Bater ponto</h3><p class="text-ink/70 mt-1">Entrada, intervalo e saída. Manual e notícias.</p></a></div>`;

// Sócio vê todas as tarefas; os demais só as que são deles (as regras também garantem isso no servidor)
const tarefasDe = async (perfil) => (await getDocs(perfil.papel === "admin" ? collection(db, "tarefas") : query(collection(db, "tarefas"), where("responsaveis", "array-contains", perfil.uid))))
  .docs.map((d) => ({ id: d.id, ...d.data() }));
async function recebPendentes(perfil) {
  if (!(perfil.papel === "admin" || perfil.papel === "gerente" || perfil.conferente === true)) return 0;
  try { return (await getDocs(query(collection(db, "recebimentos"), where("status", "==", "pendente")))).size; } catch (e) { console.error(e); return 0; }
}
const avisoReceb = (n) => (n ? `<a class="card block mb-4" href="#/estoque" style="border-left:10px solid var(--orange)"><h3 class="h2">${n} compra${n > 1 ? "s" : ""} aguardando conferência</h3><p class="text-ink/70 mt-1">Abra Estoque e toque em Recebimentos para conferir o que chegou.</p></a>` : "");

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  const topo = `<div class="card mb-4"><h2 class="h2">Olá, ${esc(perfil.nome.split(" ")[0])}!</h2>
    <p class="text-ink/70 mt-1">Você entrou como <b>${esc(PAPEIS[perfil.papel] || perfil.papel)}</b>.</p></div>`;

  if (perfil.papel === "funcionario") {
    const [al, nRec] = await Promise.all([alertasPendentes(perfil), recebPendentes(perfil)]);
    el.innerHTML = topo + htmlAlertas(al) + avisoReceb(nRec) + atalhos;
    ligarAlertas(el, perfil);
    return;
  }

  el.innerHTML = topo + `<p class="text-ink/70">Carregando indicadores…</p>`;
  const pegar = async (n) => (await getDocs(collection(db, n))).docs.map((d) => ({ id: d.id, ...d.data() }));
  let tar = [], forn = [], orc = [], pat = [], lan = [], reemb = [], cfg = {}, ins = [], lot = [];
  try {
    [tar, forn, orc, pat, lan, reemb, ins, lot] = await Promise.all([tarefasDe(perfil), admin ? pegar("fornecedores") : [], admin ? pegar("orcamentos") : [], admin ? pegar("patrimonio") : [], admin ? pegar("lancamentos") : [], admin ? pegar("reembolsos") : [], pegar("insumos"),
      getDocs(query(collection(db, "lotes"), where("qtdAtual", ">", 0))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))]);
    if (admin) { const c = await getDoc(doc(db, "config", "geral")); cfg = c.exists() ? c.data() : {}; lan = [...lan, ...(await carregarEntradas())]; }
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

  const alGer = admin ? [] : await alertasPendentes(perfil), nRec = await recebPendentes(perfil);
  el.innerHTML = topo + (admin ? "" : htmlAlertas(alGer)) + avisoReceb(nRec) + `
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
  ligarAlertas(el, perfil);
}
