import { db } from "../firebase.js";
import { esc, PAPEIS, hojeISO, fmtDia, brl } from "../util.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const kpi = (rotulo, valor, dica = "") =>
  `<div class="card"><div class="text-off/60 text-sm">${rotulo}</div>
   <div class="text-3xl font-extrabold mt-1">${valor}</div>
   ${dica ? `<div class="text-xs text-off/50 mt-1">${dica}</div>` : ""}</div>`;

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  const topo = `<div class="card mb-4"><h2 class="h2">Olá, ${esc(perfil.nome.split(" ")[0])}!</h2>
    <p class="text-off/70 mt-1">Você entrou como <b>${esc(PAPEIS[perfil.papel] || perfil.papel)}</b>.</p></div>`;

  if (perfil.papel === "funcionario") {
    el.innerHTML = topo + `<div class="card"><h2 class="h2">Em breve</h2>
      <p class="text-off/70 mt-1">Aqui vão aparecer seus avisos, o manual do funcionário e o ponto.</p></div>`;
    return;
  }

  el.innerHTML = topo + `<p class="text-off/60">Carregando indicadores…</p>`;
  const pegar = async (n) => (await getDocs(collection(db, n))).docs.map((d) => ({ id: d.id, ...d.data() }));
  let tar = [], forn = [], orc = [];
  try {
    [tar, forn, orc] = await Promise.all([pegar("tarefas"), admin ? pegar("fornecedores") : [], admin ? pegar("orcamentos") : []]);
  } catch (e) {
    console.error(e);
    el.innerHTML = topo + `<div class="card">Não foi possível carregar os indicadores.</div>`;
    return;
  }

  const hoje = hojeISO();
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
    extra = kpi("Fornecedores", forn.length) + kpi("Orçamentos sem escolha", pend, "itens aguardando decisão") +
            kpi("Total dos orçamentos escolhidos", brl(total));
  }

  el.innerHTML = topo + `
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
      ${kpi("Tarefas em aberto", abertas.length)}
      ${kpi("Em andamento", andamento.length)}
      ${kpi("Atrasadas", atrasadas.length, atrasadas.length ? "passaram do prazo" : "tudo em dia")}
      ${kpi("Pontos a melhorar", melhorias.length, "em aberto")}
      ${extra}
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card"><h2 class="h2 mb-2">Implantação</h2>
        <div class="h-3 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-brand" style="width:${pct}%"></div></div>
        <p class="text-sm text-off/70 mt-2">${pct}% concluído (${impl.filter((t) => t.status === "concluido").length} de ${impl.length} tarefas)</p>
      </div>
      <div class="card"><h2 class="h2 mb-2">Próximos prazos</h2>
        ${proximas.length ? `<ul class="space-y-1">${proximas.map((t) => `<li class="flex gap-2">
          <span class="tag ${t.prazo < hoje ? "bad" : ""}">${fmtDia(t.prazo)}</span><span>${esc(t.titulo)}</span>
          <span class="text-off/50 text-sm">· ${esc(t.responsavel)}</span></li>`).join("")}</ul>`
          : '<p class="text-off/60">Nenhuma tarefa com prazo.</p>'}
        <a class="underline text-brand text-sm mt-3 inline-block" href="#/tarefas">Abrir tarefas</a>
      </div>
    </div>
    ${admin ? `<p class="text-xs text-off/50 mt-4">Os indicadores financeiros (caixa, empréstimos dos sócios) entram na Fase 4.</p>` : ""}`;
}
