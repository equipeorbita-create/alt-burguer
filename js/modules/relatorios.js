import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, brl, fmtDia } from "../util.js";
import { carregarEquipe } from "../core/equipe.js";
import { criarCalc, indicadores, fmtQtd } from "../core/custos.js";
import { estoqueDe, diasAte } from "../core/estoque-calc.js";
import { mesAtual, inicioMesMs, fimMesMs, agruparTurnos, totalSegundos, fmtHoras } from "../core/ponto.js";
import { collection, doc, getDoc, getDocs, query, where, orderBy, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(traduzErro(e)); };
const csvCel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const dec = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
const todos = async (nome) => (await getDocs(collection(db, nome))).docs.map((d) => ({ id: d.id, ...d.data() }));
const mesesAtras = (mes, n) => { let [a, m] = mes.split("-").map(Number); m -= n; while (m < 1) { m += 12; a--; } return `${a}-${String(m).padStart(2, "0")}`; };
const nomeMes = (m) => new Date(inicioMesMs(m) + 864e5).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Fortaleza" });

export async function render(el, { perfil }) {
  let aba = "fin", mes = mesAtual(), ultimo = null;
  const ABAS = [["fin", "Financeiro"], ["card", "Cardápio e CMV"], ["est", "Estoque"], ["eq", "Equipe"]];

  el.innerHTML = `<div id="raiz"><div id="abas" class="flex flex-wrap gap-3 mb-4"></div>
    <div class="flex flex-wrap items-end gap-3 mb-5 no-print"><label>Mês de referência<input id="mes" type="month" class="input" value="${mes}" style="margin:0"></label>
      <span class="flex-1"></span><button class="btn-alt" data-act="csv">Exportar CSV</button><button class="btn-alt" data-act="imprimir">Imprimir / PDF</button></div>
    <div id="corpo"><p class="text-ink/70">Carregando…</p></div></div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo");

  // ---------- helpers de tela ----------
  const kpi = (r, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${r}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
  const grade = (cab, linhas, vazio = "Sem dados no período.") => linhas.length
    ? `<div class="card"><table><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></div>` : `<div class="card">${vazio}</div>`;
  const tira = (h) => String(h).replace(/<[^>]*>/g, "");

  // ---------- Financeiro ----------
  async function rFin() {
    const lan = await todos("lancamentos"), cfgS = await getDoc(doc(db, "config", "geral")), caixaIni = cfgS.exists() ? cfgS.data().caixaInicial || 0 : 0;
    const soma = (m, f) => lan.filter((l) => l.data.startsWith(m) && f(l)).reduce((s, l) => s + l.valor, 0);
    const ent = soma(mes, (l) => l.tipo === "entrada"), des = soma(mes, (l) => l.tipo === "despesa"), ret = soma(mes, (l) => l.tipo === "retirada");
    const meses = Array.from({ length: 6 }, (_, i) => mesesAtras(mes, 5 - i));
    const linhas = meses.map((m) => { const e = soma(m, (l) => l.tipo === "entrada"), d = soma(m, (l) => l.tipo === "despesa"), r = soma(m, (l) => l.tipo === "retirada"); return [nomeMes(m), brl(e), brl(d), brl(r), `<b>${brl(e - d)}</b>`]; });
    const porCat = {}; lan.filter((l) => l.data.startsWith(mes) && l.tipo === "despesa").forEach((l) => { porCat[l.categoria] = (porCat[l.categoria] || 0) + l.valor; });
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]), max = cats[0]?.[1] || 1;
    const canais = {}; lan.filter((l) => l.data.startsWith(mes) && l.tipo === "entrada").forEach((l) => { const c = l.canal || "não informado"; canais[c] = (canais[c] || 0) + l.valor; });
    let cx = Number(caixaIni) || 0;
    lan.forEach((l) => { if (["emprestimo", "entrada"].includes(l.tipo)) cx += l.valor; else if (l.tipo === "despesa") { if (!l.socioId) cx -= l.valor; } else cx -= l.valor; });
    ultimo = { nome: `financeiro-${mes}`, cab: ["Mês", "Entradas", "Despesas", "Retiradas", "Resultado"], linhas: linhas.map((l) => l.map(tira)) };
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5">${kpi("Entradas", brl(ent), nomeMes(mes))}${kpi("Despesas", brl(des))}${kpi("Resultado do mês", brl(ent - des), "entradas menos despesas")}${kpi("Saldo em caixa hoje", brl(cx))}</div>
      <h3 class="h2 mb-3">Últimos 6 meses</h3>${grade(ultimo.cab, linhas)}
      <div class="grid gap-4 lg:grid-cols-2 mt-5"><div class="card"><h3 class="h2 mb-2">Despesas por categoria</h3>${cats.length ? cats.map(([c, v]) => `<div class="mb-3"><div class="flex justify-between text-sm"><span>${esc(c)}</span><span>${brl(v)}</span></div><div class="h-2 rounded-full bg-ink/10 overflow-hidden"><div class="h-full bg-brand" style="width:${(v / max) * 100}%"></div></div></div>`).join("") : "<p>Sem despesas no mês.</p>"}</div>
        <div class="card"><h3 class="h2 mb-2">Entradas por canal</h3>${Object.keys(canais).length ? Object.entries(canais).map(([c, v]) => `<p class="flex justify-between py-1"><span class="capitalize">${esc(c)}</span><b>${brl(v)}</b></p>`).join("") : "<p>Sem entradas no mês.</p>"}<p class="text-xs text-ink/70 mt-2">Retiradas no mês: ${brl(ret)}</p></div></div>`;
  }

  // ---------- Cardápio e CMV ----------
  async function rCard() {
    const [rec, custosL, precosL, cfgS] = await Promise.all([todos("receitas"), todos("insumos_custos"), todos("receitas_precos"), getDoc(doc(db, "config", "geral"))]);
    const custos = Object.fromEntries(custosL.map((c) => [c.id, c])), precos = Object.fromEntries(precosL.map((p) => [p.id, p])), cfg = cfgS.exists() ? cfgS.data() : {};
    const calc = criarCalc({ insumos: [], receitas: rec, custos });
    const linhas = rec.filter((r) => r.tipo === "prato" && r.ativo !== false).map((r) => {
      const k = calc.custoReceita(r), p = precos[r.id]?.precoVenda, meta = precos[r.id]?.metaCMV ?? cfg.metaCMVporCategoria?.[r.categoria] ?? cfg.metaCMV ?? 30;
      return { r, k, p, meta, i: indicadores({ custo: k.total, preco: p, meta, taxasPct: cfg.taxasPct || 0 }) };
    }).sort((a, b) => (b.i.cmv ?? -1) - (a.i.cmv ?? -1));
    const acima = linhas.filter((x) => x.i.situacao === "alto" || x.i.situacao === "atencao").length;
    const rows = linhas.map((x) => [`<b>${esc(x.r.nome)}</b><br><small class="text-ink/70">${esc(x.r.categoria || "")}</small>`, brl(x.k.total) + (x.k.incompleto ? ' <span class="tag bad">incompleto</span>' : ""),
      x.p > 0 ? brl(x.p) : "—", x.i.cmv != null ? `<span class="tag ${x.i.situacao === "ok" ? "ok" : x.i.situacao === "alto" ? "bad" : ""}">${x.i.cmv.toFixed(1)}%</span>` : "—", `${x.meta}%`,
      x.i.margem != null ? `${brl(x.i.margem)} (${x.i.margemPct.toFixed(0)}%)` : "—", x.i.sugerido && x.i.situacao !== "ok" ? brl(x.i.sugerido) : "—"]);
    ultimo = { nome: "cardapio-cmv", cab: ["Prato", "Custo", "Preço", "CMV", "Meta", "Margem", "Preço sugerido"], linhas: rows.map((l) => l.map(tira)) };
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-3 mb-5">${kpi("Pratos ativos", linhas.length)}${kpi("Acima da meta de CMV", acima, "ordenados do pior para o melhor")}${kpi("Sem preço de venda", linhas.filter((x) => !(x.p > 0)).length)}</div>
      ${grade(ultimo.cab, rows, "Nenhum prato cadastrado.")}<p class="text-xs text-ink/70 mt-2">O custo usa o último preço pago de cada insumo. "Incompleto" = falta preço de algum ingrediente.</p>`;
  }

  // ---------- Estoque ----------
  async function rEst() {
    const ini = Timestamp.fromMillis(inicioMesMs(mes)), fim = Timestamp.fromMillis(fimMesMs(mes));
    const [movs, ins, lot, custosL, rec] = await Promise.all([
      getDocs(query(collection(db, "movimentacoes"), where("em", ">=", ini), where("em", "<", fim), orderBy("em"))).then((s) => s.docs.map((d) => d.data())),
      todos("insumos"), getDocs(query(collection(db, "lotes"), where("qtdAtual", ">", 0))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))), todos("insumos_custos"), todos("receitas")]);
    const custos = Object.fromEntries(custosL.map((c) => [c.id, c])), calc = criarCalc({ insumos: ins, receitas: rec, custos });
    const unit = (id) => custos[id]?.custoUnitario ?? calc.custoUnitario("preparo", id).valor ?? 0;
    const por = {};
    for (const m of movs) {
      if (!["baixa", "descarte", "producao"].includes(m.tipo) || m.delta >= 0) continue;
      const o = por[m.insumoId] || (por[m.insumoId] = { nome: m.insumoNome, un: m.unidade, uso: 0, desc: 0, id: m.insumoId });
      if (m.tipo === "descarte") o.desc += -m.delta; else o.uso += -m.delta;
    }
    const lista = Object.values(por).sort((a, b) => (b.desc * unit(b.id)) - (a.desc * unit(a.id)) || b.uso - a.uso);
    const perdas = lista.reduce((s, o) => s + o.desc * unit(o.id), 0);
    const valorEst = lot.reduce((s, l) => s + l.qtdAtual * unit(l.insumoId), 0);
    const baixos = ins.filter((i) => i.ativo !== false && estoqueDe(lot, i.id) < i.estoqueMinimo), venc = lot.filter((l) => l.validade && diasAte(l.validade) <= 7);
    const compras = movs.filter((m) => m.tipo === "compra").length;
    const rows = lista.map((o) => [`<b>${esc(o.nome)}</b>`, fmtQtd(o.uso, o.un), o.desc ? fmtQtd(o.desc, o.un) : "—", o.desc ? `<span class="tag bad">${brl(o.desc * unit(o.id))}</span>` : "—"]);
    ultimo = { nome: `estoque-${mes}`, cab: ["Item", "Saídas (uso e produção)", "Descartes e perdas", "Valor descartado"], linhas: rows.map((l) => l.map(tira)) };
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5">${kpi("Valor em estoque hoje", brl(valorEst))}${kpi("Perdas no mês", brl(perdas), "descartes e vencidos")}${kpi("Abaixo do mínimo", baixos.length, baixos.slice(0, 3).map((i) => esc(i.nome)).join(", "))}${kpi("Lotes vencendo (7 dias)", venc.length, `${compras} compras no mês`)}</div>
      <h3 class="h2 mb-3">Movimento de ${nomeMes(mes)}</h3>${grade(ultimo.cab, rows, "Sem movimentações no mês.")}`;
  }

  // ---------- Equipe ----------
  async function rEq() {
    const equipe = await carregarEquipe(perfil), ini = Timestamp.fromMillis(inicioMesMs(mes) - 2 * 864e5);
    const l = await Promise.all(equipe.map(async (m) => {
      const regs = (await getDocs(query(collection(db, "ponto", m.uid, "registros"), where("em", ">=", ini), orderBy("em")))).docs.map((d) => { const x = d.data(); return { ...x, ms: x.em.toMillis() }; });
      const ts = agruparTurnos(regs).filter((t) => { const k = t.inicio ?? t.regs[0].ms; return k >= inicioMesMs(mes) && k < fimMesMs(mes); });
      const dias = ts.filter((t) => !t.incompleto).length, seg = totalSegundos(ts);
      return { m, dias, seg, inc: ts.filter((t) => t.incompleto).length, aj: ts.flatMap((t) => t.regs).filter((r) => r.origem === "ajuste").length };
    }));
    const rows = l.map((x) => [`<b>${esc(x.m.nome)}</b>`, x.dias, fmtHoras(x.seg), x.dias ? fmtHoras(x.seg / x.dias) : "—", x.inc ? `<span class="tag bad">${x.inc}</span>` : "0", x.aj]);
    ultimo = { nome: `equipe-${mes}`, cab: ["Funcionário", "Dias", "Horas", "Média por dia", "Incompletos", "Registros por ajuste"], linhas: rows.map((r) => r.map(tira)) };
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-3 mb-5">${kpi("Funcionários ativos", equipe.length)}${kpi("Horas totais no mês", fmtHoras(l.reduce((s, x) => s + x.seg, 0)), nomeMes(mes))}${kpi("Turnos incompletos", l.reduce((s, x) => s + x.inc, 0), "falta saída ou entrada")}</div>
      ${grade(ultimo.cab, rows, "Nenhum funcionário ativo.")}`;
  }

  async function carregar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    corpo.innerHTML = '<p class="text-ink/70">Carregando…</p>';
    try { await ({ fin: rFin, card: rCard, est: rEst, eq: rEq }[aba])(); } catch (e) { erro(e); corpo.innerHTML = '<div class="card">Não foi possível carregar o relatório.</div>'; }
  }

  raiz.addEventListener("click", (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return carregar(); }
    const b = e.target.closest("[data-act]");
    if (!b || !ultimo) return;
    if (b.dataset.act === "imprimir") return window.print();
    const txt = [ultimo.cab.map(csvCel).join(";"), ...ultimo.linhas.map((l) => l.map(csvCel).join(";"))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + txt], { type: "text/csv" })); a.download = `${ultimo.nome}.csv`; a.click();
  });
  raiz.addEventListener("change", (e) => { if (e.target.id === "mes" && e.target.value) { mes = e.target.value; carregar(); } });
  await carregar();
}
