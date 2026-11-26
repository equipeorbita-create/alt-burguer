import { db, auth } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia, fmtData } from "../util.js";
import { FORMAS_PADRAO, calcVenda, esperadoGaveta, entradasSinteticas, projecaoFluxo, listarFaturas } from "../core/caixa.js";
import { resumo } from "../core/financas.js";
import { somaDias } from "../core/rotinas.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, writeBatch, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(traduzErro(e)); };
const num = (n) => String(n ?? "").replace(".", ",");
const dec = (s) => { const v = parseBRL(s === "" || s == null ? "0" : s); return v; };
const nomeMes = (ym) => new Date(Date.parse(ym + "-15T12:00:00Z")).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

export async function render(el, { perfil }) {
  const uid = auth.currentUser.uid, admin = perfil.papel === "admin", hoje = hojeISO();
  let cfg = { formas: FORMAS_PADRAO, fundoPadrao: 0, salvo: false }, geral = {}, status = [], fechs = [], recebs = [], lancs = [], contas = [], cartoes = [], faturasPagas = [];
  let aba = "fech", dataSel = hoje, formaPronta = false, nomesEditando = null;
  const ABAS = [["fech", "Fechamento"], ["hist", "Histórico"], ...(admin ? [["rec", "A receber"], ["fluxo", "Fluxo de caixa"], ["cfg", "Taxas e prazos"]] : [])];

  el.innerHTML = `<div id="raiz"><div id="abas" class="flex flex-wrap gap-3 mb-5"></div><div id="corpo"></div><dialog id="dD"></dialog></div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo"), dD = raiz.querySelector("#dD");
  const formas = () => cfg.formas.filter((f) => f.ativo !== false);
  const stDe = (d) => status.find((s) => s.id === d);

  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    formaPronta = false; nomesEditando = null;
    corpo.innerHTML = { fech: mFech, hist: mHist, rec: mRec, fluxo: mFluxo, cfg: mCfg }[aba]();
    atualizar();
  }
  const atualizar = () => ({ fech: aFech, hist: aHist, rec: aRec, fluxo: aFluxo, cfg: aCfg }[aba])();

  // ===================== FECHAMENTO DO DIA =====================
  const mFech = () => `${cfg.salvo ? "" : '<p class="card mb-4" style="border-left:10px solid var(--orange)">As <b>taxas e prazos de recebimento</b> ainda não foram configurados. Enquanto isso o sistema usa taxa 0% e recebimento imediato.</p>'}
    <div class="card" style="max-width:38rem"><label>Data do fechamento<input id="fdata" type="date" class="input" value="${dataSel}" max="${hoje}"></label><div id="fstat" class="mt-4"></div><div id="fform"></div></div>`;

  function aFech() {
    const st = stDe(dataSel), box = raiz.querySelector("#fstat"), form = raiz.querySelector("#fform");
    if (st && st.status === "fechado") {
      formaPronta = false; form.innerHTML = "";
      box.innerHTML = `<p><span class="tag ok">Dia fechado</span> por <b>${esc(st.fechadoPorNome)}</b> em ${fmtData(st.fechadoEm)}</p>
        <p class="mt-2">Diferença no caixa: <span class="tag ${st.diferenca === 0 ? "ok" : "bad"}">${st.diferenca === 0 ? "confere" : (st.diferenca > 0 ? "sobra " : "falta ") + brl(Math.abs(st.diferenca))}</span></p>
        <p class="text-sm text-ink/70 mt-2">${admin ? 'Para corrigir, reabra o dia em "Histórico".' : "Só os sócios podem reabrir um dia já fechado."}</p>`;
      return;
    }
    box.innerHTML = st ? `<p class="mb-3"><span class="tag bad">Dia reaberto</span> Refaça o fechamento abaixo.</p>` : "";
    if (formaPronta) return;
    formaPronta = true;
    form.innerHTML = `<label class="mt-4">Fundo de caixa (troco do início do dia)<input id="ffundo" data-fc class="input" inputmode="decimal" value="${num(cfg.fundoPadrao || "")}" placeholder="0,00"></label>
      <h3 class="h2 mt-5 mb-1">Vendas do dia, por forma de recebimento</h3>
      ${formas().map((f) => `<label class="mt-3">${esc(f.nome)}<input data-fc data-forma="${f.id}" class="input" inputmode="decimal" placeholder="0,00"></label>`).join("")}
      <div class="grid grid-cols-2 gap-4 mt-5"><label>Sangrias (dinheiro retirado da gaveta)<input id="fsang" data-fc class="input" inputmode="decimal" placeholder="0,00"></label>
        <label>Despesas pagas em dinheiro hoje<input id="fdesp" data-fc class="input" inputmode="decimal" placeholder="0,00"></label></div>
      <label class="mt-4">Dinheiro contado na gaveta agora<input id="fcont" data-fc class="input" inputmode="decimal" placeholder="0,00"></label>
      <div id="fres" class="card mt-5" style="background:var(--paper)"></div>
      <label class="mt-4">Observações (obrigatório se houver diferença)<textarea id="fobs" class="input" rows="2" maxlength="300"></textarea></label>
      <button class="btn w-full mt-5" data-act="fechar" style="min-height:58px">Fechar o dia</button>`;
    calcular();
  }

  function leitura() {
    const v = {}; let bad = false;
    raiz.querySelectorAll("[data-forma]").forEach((i) => { const n = dec(i.value); if (isNaN(n) || n < 0) bad = true; v[i.dataset.forma] = isNaN(n) ? 0 : n; });
    const g = (id) => { const n = dec(raiz.querySelector(id).value); if (isNaN(n) || n < 0) bad = true; return isNaN(n) ? 0 : n; };
    const contTxt = raiz.querySelector("#fcont").value.trim();
    return { v, bad, fundo: g("#ffundo"), sang: g("#fsang"), desp: g("#fdesp"), cont: g("#fcont"), contPreenchida: contTxt !== "" };
  }
  function calcular() {
    const L = leitura(), box = raiz.querySelector("#fres"); if (!box) return;
    const vendas = formas().map((f) => ({ f, ...calcVenda(f, L.v[f.id] || 0) })), bruto = vendas.reduce((s, x) => s + x.bruto, 0), taxas = vendas.reduce((s, x) => s + x.taxa, 0);
    const esperado = esperadoGaveta({ fundo: L.fundo, dinheiro: L.v.dinheiro || 0, sangrias: L.sang, despesasDinheiro: L.desp }), dif = Math.round((L.cont - esperado) * 100) / 100;
    box.innerHTML = `<p class="flex justify-between"><span>Total vendido</span><b>${brl(bruto)}</b></p>
      ${admin ? `<p class="flex justify-between text-sm text-ink/70"><span>Taxas previstas</span><span>- ${brl(taxas)}</span></p><p class="flex justify-between text-sm text-ink/70"><span>Líquido a receber</span><span>${brl(bruto - taxas)}</span></p>` : ""}
      <hr class="my-3" style="border-color:var(--line)"><p class="flex justify-between"><span>Dinheiro esperado na gaveta</span><b>${brl(esperado)}</b></p>
      <p class="flex justify-between mt-1"><span>Diferença</span>${L.contPreenchida ? `<span class="tag ${dif === 0 ? "ok" : "bad"}">${dif === 0 ? "confere" : (dif > 0 ? "sobra " : "falta ") + brl(Math.abs(dif))}</span>` : "<span>informe a contagem</span>"}</p>`;
  }

  async function fechar() {
    const L = leitura(), obs = raiz.querySelector("#fobs").value.trim();
    if (L.bad) return toast("Confira os valores: use só números positivos.");
    if (!L.contPreenchida) return toast("Informe o dinheiro contado na gaveta (pode ser 0).");
    const vendas = formas().map((f) => ({ formaId: f.id, nome: f.nome, ...calcVenda(f, L.v[f.id] || 0), taxaPct: f.taxaPct || 0 })).filter((x) => x.bruto > 0).map((x) => ({ ...x, imediato: !x.prazo }));
    const bruto = vendas.reduce((s, x) => s + x.bruto, 0), taxas = vendas.reduce((s, x) => s + x.taxa, 0);
    const esperado = esperadoGaveta({ fundo: L.fundo, dinheiro: L.v.dinheiro || 0, sangrias: L.sang, despesasDinheiro: L.desp }), dif = Math.round((L.cont - esperado) * 100) / 100;
    if (dif !== 0 && !obs) return toast("Há diferença no caixa: explique nas observações antes de fechar.");
    if (!vendas.length && !confirm("Nenhuma venda informada. Fechar o dia sem vendas?")) return;
    if (!confirm(`Fechar o dia ${fmtDia(dataSel)}?\nVendas: ${brl(bruto)}\nDiferença no caixa: ${dif === 0 ? "confere" : brl(dif)}`)) return;
    const lote = writeBatch(db), ag = { fechadoPor: uid, fechadoPorNome: perfil.nome, fechadoEm: serverTimestamp() };
    lote.set(doc(db, "fechamentos", dataSel), { data: dataSel, status: "fechado", fundo: L.fundo, vendas, sangrias: L.sang, despesasDinheiro: L.desp, contagem: L.cont, esperado, diferenca: dif, obs,
      totalBruto: Math.round(bruto * 100) / 100, totalTaxas: Math.round(taxas * 100) / 100, totalLiquido: Math.round((bruto - taxas) * 100) / 100, ...ag });
    lote.set(doc(db, "fechamentos_status", dataSel), { data: dataSel, status: "fechado", diferenca: dif, ...ag });
    vendas.filter((x) => x.prazo > 0).forEach((x) => lote.set(doc(db, "recebiveis", `${dataSel}_${x.formaId}`), { data: dataSel, formaId: x.formaId, formaNome: x.nome, bruto: x.bruto, taxa: x.taxa, liquido: x.liquido,
      prazo: x.prazo, previsto: somaDias(dataSel, x.prazo), status: "previsto", fechamentoId: dataSel, criadoPor: uid }));
    await lote.commit();
    await auditar(perfil, "caixa_fechado", `${dataSel}: vendas ${brl(bruto)}, diferença ${brl(dif)}`);
    formaPronta = false; toast("Dia fechado.");
  }

  // ===================== HISTÓRICO =====================
  const mHist = () => `<div id="hlista"></div>`;
  function aHist() {
    const f = Object.fromEntries(fechs.map((x) => [x.id, x]));
    raiz.querySelector("#hlista").innerHTML = status.length ? `<div class="card"><table><tr><th>Dia</th><th>Situação</th><th>Fechado por</th><th>Caixa</th>${admin ? "<th>Vendas</th><th></th>" : ""}</tr>
      ${status.map((s) => `<tr><td><b>${fmtDia(s.data)}</b></td><td><span class="tag ${s.status === "fechado" ? "ok" : "bad"}">${s.status === "fechado" ? "Fechado" : "Reaberto"}</span></td><td>${esc(s.fechadoPorNome)}</td>
        <td><span class="tag ${s.diferenca === 0 ? "ok" : "bad"}">${s.diferenca === 0 ? "confere" : (s.diferenca > 0 ? "sobra " : "falta ") + brl(Math.abs(s.diferenca))}</span></td>
        ${admin ? `<td>${f[s.id] ? brl(f[s.id].totalBruto) : "—"}</td><td class="whitespace-nowrap"><button class="btn-alt" data-act="det" data-id="${s.id}">Detalhes</button>${s.status === "fechado" ? ` <button class="btn-alt" data-act="reabrir" data-id="${s.id}">Reabrir</button>` : ""}</td>` : ""}</tr>`).join("")}</table></div>`
      : '<div class="card">Nenhum fechamento registrado ainda.</div>';
  }
  function detalhe(id) {
    const f = fechs.find((x) => x.id === id); if (!f) return;
    dD.innerHTML = `<div class="flex items-start gap-3"><h2 class="h2 flex-1">Fechamento de ${fmtDia(f.data)}</h2><button class="btn-alt" data-fechar="dD">Fechar</button></div>
      <p class="text-sm text-ink/70 mt-1">${esc(f.fechadoPorNome)} · ${fmtData(f.fechadoEm)}</p>
      <table class="mt-3"><tr><th>Forma</th><th>Bruto</th><th>Taxa</th><th>Líquido</th><th>Prazo</th></tr>${(f.vendas || []).map((v) => `<tr><td>${esc(v.nome)}</td><td>${brl(v.bruto)}</td><td>${brl(v.taxa)} <small>(${num(v.taxaPct)}%)</small></td><td>${brl(v.liquido)}</td><td>${v.prazo ? v.prazo + " dias" : "na hora"}</td></tr>`).join("") || '<tr><td colspan="5">Sem vendas.</td></tr>'}</table>
      <p class="mt-3">Total: <b>${brl(f.totalBruto)}</b> · taxas ${brl(f.totalTaxas)} · líquido ${brl(f.totalLiquido)}</p>
      <p class="mt-2 text-sm">Fundo ${brl(f.fundo)} · sangrias ${brl(f.sangrias)} · despesas em dinheiro ${brl(f.despesasDinheiro)} · contado ${brl(f.contagem)} · esperado ${brl(f.esperado)}</p>
      ${f.obs ? `<p class="mt-2 text-ink/70"><b>Obs.:</b> ${esc(f.obs)}</p>` : ""}`;
    dD.showModal();
  }
  async function reabrir(id) {
    const rs = recebs.filter((r) => r.fechamentoId === id);
    if (rs.some((r) => r.status === "recebido")) return toast("Não dá para reabrir: parte desse dia já foi marcada como recebida.");
    const motivo = prompt(`Reabrir o dia ${fmtDia(id)}? Explique o motivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    const lote = writeBatch(db);
    lote.update(doc(db, "fechamentos", id), { status: "reaberto", reabertoPor: uid, reabertoPorNome: perfil.nome, reabertoMotivo: motivo.trim() });
    lote.update(doc(db, "fechamentos_status", id), { status: "reaberto" });
    rs.forEach((r) => lote.delete(doc(db, "recebiveis", r.id)));
    await lote.commit();
    await auditar(perfil, "caixa_reaberto", `${id}: ${motivo.trim()}`);
    toast("Dia reaberto. O gerente ou um sócio pode fechar de novo.");
  }

  // ===================== A RECEBER =====================
  const mRec = () => `<div id="rkpi" class="grid gap-4 sm:grid-cols-3 mb-5"></div><div id="rlista"></div>`;
  function aRec() {
    const pr = recebs.filter((r) => r.status === "previsto").sort((a, b) => a.previsto.localeCompare(b.previsto)), venc = pr.filter((r) => r.previsto <= hoje);
    const k = (t, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${t}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
    raiz.querySelector("#rkpi").innerHTML = k("A receber (líquido)", brl(pr.reduce((s, r) => s + r.liquido, 0)), `${pr.length} recebimentos`) + k("Já deveria ter caído", brl(venc.reduce((s, r) => s + r.liquido, 0)), `${venc.length} vencidos`) +
      `<div class="card flex items-center">${venc.length ? `<button class="btn w-full" data-act="receberTodos">Marcar vencidos como recebidos</button>` : '<span class="text-ink/70">Nada vencido para receber.</span>'}</div>`;
    raiz.querySelector("#rlista").innerHTML = pr.length ? `<div class="card"><table><tr><th>Forma</th><th>Vendas de</th><th>Bruto</th><th>Taxa</th><th>Líquido</th><th>Previsto</th><th></th></tr>
      ${pr.map((r) => `<tr><td><b>${esc(r.formaNome)}</b></td><td>${fmtDia(r.data)}</td><td>${brl(r.bruto)}</td><td>${brl(r.taxa)}</td><td>${brl(r.liquido)}</td>
        <td>${r.previsto <= hoje ? `<span class="tag bad">${fmtDia(r.previsto)}</span>` : fmtDia(r.previsto)}</td><td><button class="btn-alt" data-act="receber" data-id="${r.id}">Recebi</button></td></tr>`).join("")}</table></div>`
      : '<div class="card">Nenhum recebimento pendente. Eles aparecem aqui quando o fechamento tem formas com prazo (crédito, apps etc.).</div>';
  }
  async function receber(ids) {
    const lote = writeBatch(db);
    ids.forEach((id) => lote.update(doc(db, "recebiveis", id), { status: "recebido", recebidoEm: hoje, recebidoPor: uid, recebidoPorNome: perfil.nome }));
    await lote.commit();
    await auditar(perfil, "recebimento_baixado", `${ids.length} recebimento(s) marcados como recebidos`);
    toast(ids.length > 1 ? `${ids.length} recebimentos baixados.` : "Recebimento baixado.");
  }

  // ===================== FLUXO DE CAIXA =====================
  const mFluxo = () => `<div id="fkpi" class="grid gap-4 sm:grid-cols-3 mb-5"></div><h3 class="h2 mb-3">Próximos 30 dias</h3><div id="fproj"></div><h3 class="h2 mb-3 mt-6">Faturamento por mês</h3><div id="ffat"></div>`;
  function aFluxo() {
    const todas = [...lancs, ...entradasSinteticas(fechs, recebs)], saldo = resumo(todas, geral.caixaInicial || 0).caixa;
    const cart = cartoes.flatMap((c) => listarFaturas(lancs, c, faturasPagas)), abertas = contas.filter((c) => c.status === "aberta");
    const linhas = projecaoFluxo({ saldo, recebiveis: recebs, contas: abertas, faturas: cart, hoje, dias: 30 });
    const k = (t, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${t}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
    raiz.querySelector("#fkpi").innerHTML = k("Saldo em caixa hoje", brl(saldo)) + k("A receber (previsto)", brl(recebs.filter((r) => r.status === "previsto").reduce((s, r) => s + r.liquido, 0))) +
      k("A pagar (contas e faturas)", brl(abertas.reduce((s, c) => s + c.valor, 0) + cart.filter((f) => !f.paga).reduce((s, f) => s + f.total, 0)));
    raiz.querySelector("#fproj").innerHTML = `<div class="card"><table><tr><th>Dia</th><th>Entra</th><th>Sai</th><th>Saldo previsto</th></tr>${linhas.map((l, i) => `<tr><td>${i === 0 ? "Hoje e vencidos" : fmtDia(l.data)}</td><td style="color:#1d7a46">${l.receber ? "+ " + brl(l.receber) : "—"}</td><td style="color:#B8470B">${l.pagar ? "- " + brl(l.pagar) : "—"}</td>
      <td><b class="${l.saldo < 0 ? "tag bad" : ""}">${brl(l.saldo)}</b></td></tr>`).join("")}</table></div><p class="text-xs text-ink/70 mt-2">Considera o que está previsto a receber, as contas a pagar em aberto e as faturas do cartão ainda não pagas.</p>`;
    const meses = {}; fechs.filter((f) => f.status === "fechado").forEach((f) => { const m = f.data.slice(0, 7), o = meses[m] || (meses[m] = { b: 0, t: 0, l: 0, n: 0 }); o.b += f.totalBruto; o.t += f.totalTaxas; o.l += f.totalLiquido; o.n++; });
    raiz.querySelector("#ffat").innerHTML = Object.keys(meses).length ? `<div class="card"><table><tr><th>Mês</th><th>Dias fechados</th><th>Faturamento</th><th>Taxas</th><th>Líquido</th></tr>${Object.entries(meses).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([m, o]) => `<tr><td class="capitalize">${nomeMes(m)}</td><td>${o.n}</td><td><b>${brl(o.b)}</b></td><td>${brl(o.t)}</td><td>${brl(o.l)}</td></tr>`).join("")}</table></div>` : '<div class="card">Ainda não há dias fechados.</div>';
  }

  // ===================== TAXAS E PRAZOS =====================
  const mCfg = () => `<div class="card" style="max-width:46rem"><p class="text-ink/70 mb-4">Para cada forma de receber, informe a <b>taxa (%)</b> cobrada e em <b>quantos dias</b> o dinheiro cai. Use 0 dias para o que entra na hora. Você pode criar formas novas (ex.: "iFood pagamento online" e "iFood pago na entrega").</p>
    <div id="cfgform"></div></div>`;
  function aCfg() {
    if (nomesEditando) return;
    nomesEditando = true;
    raiz.querySelector("#cfgform").innerHTML = `<div id="cfglin">${cfg.formas.map(linhaForma).join("")}</div>
      <button type="button" class="btn-alt mt-2" data-act="addForma">+ Nova forma de recebimento</button>
      <label class="mt-5">Fundo de caixa padrão (troco do início do dia)<input id="cfundo" class="input" inputmode="decimal" value="${num(cfg.fundoPadrao || "")}" placeholder="0,00"></label>
      <button class="btn w-full mt-5" data-act="salvarCfg">Salvar taxas e prazos</button>`;
  }
  const linhaForma = (f) => `<div class="card mb-3" data-linha data-id="${esc(f.id)}"><label>Nome<input data-k="nome" class="input" maxlength="40" value="${esc(f.nome)}"></label>
    <div class="grid grid-cols-2 gap-4 mt-3"><label>Taxa (%)<input data-k="taxa" class="input" inputmode="decimal" value="${num(f.taxaPct || 0)}"></label><label>Cai em quantos dias<input data-k="prazo" class="input" inputmode="numeric" value="${f.prazoDias || 0}"></label></div>
    <div class="flex items-center gap-4 mt-3"><label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" data-k="ativo" ${f.ativo !== false ? "checked" : ""}> Usada no fechamento</label>
    ${f.id === "dinheiro" ? '<span class="tag">obrigatória</span>' : '<button type="button" class="btn-alt" data-act="remForma">Remover</button>'}</div></div>`;
  async function salvarCfg() {
    const formasNovas = [];
    for (const l of raiz.querySelectorAll("[data-linha]")) {
      const nome = l.querySelector('[data-k="nome"]').value.trim(), taxa = dec(l.querySelector('[data-k="taxa"]').value), prazo = Number(l.querySelector('[data-k="prazo"]').value || 0);
      if (!nome) return toast("Toda forma precisa de um nome.");
      if (isNaN(taxa) || taxa < 0 || taxa > 100) return toast(`Taxa inválida em "${nome}" (de 0 a 100).`);
      if (!Number.isInteger(prazo) || prazo < 0 || prazo > 365) return toast(`Prazo inválido em "${nome}" (de 0 a 365 dias).`);
      formasNovas.push({ id: l.dataset.id, nome, taxaPct: taxa, prazoDias: prazo, ativo: l.querySelector('[data-k="ativo"]').checked });
    }
    const fundo = dec(raiz.querySelector("#cfundo").value); if (isNaN(fundo) || fundo < 0) return toast("Fundo de caixa inválido.");
    await setDoc(doc(db, "config", "recebimentos"), { formas: formasNovas, fundoPadrao: fundo, atualizadoEm: serverTimestamp() });
    await auditar(perfil, "taxas_prazos_salvos", formasNovas.map((f) => `${f.nome} ${f.taxaPct}%/${f.prazoDias}d`).join("; "));
    nomesEditando = null; toast("Taxas e prazos salvos.");
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]"); if (ab) { aba = ab.dataset.aba; return montar(); }
    const fc = e.target.closest("[data-fechar]"); if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act; b.disabled = true;
    try {
      if (a === "fechar") await fechar();
      else if (a === "det") detalhe(b.dataset.id);
      else if (a === "reabrir") await reabrir(b.dataset.id);
      else if (a === "receber") await receber([b.dataset.id]);
      else if (a === "receberTodos") { if (confirm("Marcar todos os recebimentos vencidos como recebidos?")) await receber(recebs.filter((r) => r.status === "previsto" && r.previsto <= hoje).map((r) => r.id)); }
      else if (a === "addForma") raiz.querySelector("#cfglin").insertAdjacentHTML("beforeend", linhaForma({ id: "f_" + Date.now(), nome: "", taxaPct: 0, prazoDias: 0, ativo: true }));
      else if (a === "remForma") b.closest("[data-linha]").remove();
      else if (a === "salvarCfg") await salvarCfg();
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });
  raiz.addEventListener("input", (e) => { if (e.target.matches("[data-fc]")) calcular(); });
  raiz.addEventListener("change", (e) => { if (e.target.id === "fdata" && e.target.value) { dataSel = e.target.value; formaPronta = false; aFech(); } });

  // ---------- dados em tempo real ----------
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
  const paradas = [
    onSnapshot(doc(db, "config", "recebimentos"), (s) => { cfg = s.exists() ? { formas: s.data().formas || FORMAS_PADRAO, fundoPadrao: s.data().fundoPadrao || 0, salvo: true } : { formas: FORMAS_PADRAO, fundoPadrao: 0, salvo: false }; if (aba === "fech" || aba === "cfg") { formaPronta = false; nomesEditando = null; if (aba === "fech") corpo.innerHTML = mFech(); atualizar(); } }, erro),
    onSnapshot(query(collection(db, "fechamentos_status"), orderBy("data", "desc"), limit(90)), (s) => { status = ver(s); if (aba === "fech" || aba === "hist") atualizar(); }, erro)
  ];
  if (admin) {
    const L = (nome, set, ordem) => onSnapshot(ordem ? query(collection(db, nome), ordem) : collection(db, nome), (s) => { set(ver(s)); if (aba === "hist" || aba === "rec" || aba === "fluxo") atualizar(); }, erro);
    paradas.push(L("fechamentos", (x) => { fechs = x; }, orderBy("data", "desc")), L("recebiveis", (x) => { recebs = x; }), L("lancamentos", (x) => { lancs = x; }), L("contas", (x) => { contas = x; }),
      L("cartoes", (x) => { cartoes = x.filter((c) => c.ativo !== false); }), L("faturas", (x) => { faturasPagas = x; }),
      onSnapshot(doc(db, "config", "geral"), (s) => { geral = s.exists() ? s.data() : {}; if (aba === "fluxo") atualizar(); }, erro));
  }
  montar();
  return () => paradas.forEach((p) => p());
}
