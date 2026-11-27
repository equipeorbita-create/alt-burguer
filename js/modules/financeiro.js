import { db, auth } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia } from "../util.js";
import { resumo, carregarSocios, r2, TIPOS, CATEGORIAS_PADRAO, slug } from "../core/financas.js";
import { FORMAS_PAG } from "../core/caixa.js";
import { assinarEntradas } from "../core/caixa-dados.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, doc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const num = (n) => String(n ?? 0).replace(".", ",");
const csvCel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const COM_SOCIO = ["despesa", "emprestimo", "retirada"];
const tagTipo = (t) => t === "entrada" ? `<span class="tag ok">Entrada</span>`
  : t === "retirada" ? `<span class="tag" style="background:#ffb067;color:#1c1c1c">Retirada</span>`
  : `<span class="tag">${TIPOS[t]}</span>`;

export async function render(el, { perfil }) {
  const socios = await carregarSocios();
  const nomeSocio = (id) => (socios.find((s) => s.uid === id) || {}).nome || "—";
  let lancsBase = [], extras = [], cartoes = [], lancs = [], cats = [], cfg = {}, aba = "resumo", editando = null, semeou = false;
  const filtro = { de: "", ate: "", tipo: "", cat: "", socio: "" };
  const pct = (uid) => cfg.divisao?.[uid] ?? r2(100 / (socios.length || 1));

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-3 mb-4 no-print">
      <button class="btn-alt" data-aba="resumo">Prestação de contas</button>
      <button class="btn-alt" data-aba="lanc">Lançamentos</button>
      <button class="btn-alt" data-aba="conf">Configurações</button>
      <span class="flex-1"></span>
      <button id="novo" class="btn">Novo lançamento</button>
    </div>
    <div id="corpo"></div>

    <dialog id="dL"><form id="fL" class="space-y-4">
      <h2 class="h2" id="tL"></h2>
      <label>Tipo<select name="tipo" class="input">${Object.entries(TIPOS).filter(([k]) => !["reembolso", "pagamento_fatura"].includes(k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <div class="grid grid-cols-2 gap-4">
        <label>Data<input name="data" type="date" required class="input"></label>
        <label>Valor (R$)<input name="valor" required inputmode="decimal" class="input" placeholder="1.200,00"></label>
      </div>
      <label>Descrição<input name="descricao" required maxlength="200" class="input"></label>
      <label data-campo="categoria">Categoria<select name="categoria" class="input"></select></label>
      <label data-campo="socioId"><span id="rotSocio">Sócio</span><select name="socioId" class="input"></select></label>
      <label data-campo="forma">Forma de pagamento<select name="forma" class="input">${Object.entries(FORMAS_PAG).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label data-campo="canal">Canal<select name="canal" class="input"><option value="">—</option><option value="presencial">Presencial</option><option value="delivery">Delivery</option></select></label>
      <label>Comprovante (link opcional; ou envie pelo WhatsApp)<input name="comprovante" class="input" placeholder="https://..."></label>
      <label>Observações<textarea name="obs" rows="2" maxlength="300" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" id="cancelarL" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz");
  const dL = raiz.querySelector("#dL"), fL = raiz.querySelector("#fL");

  const noPeriodo = (l) => (!filtro.de || l.data >= filtro.de) && (!filtro.ate || l.data <= filtro.ate);
  const periodoHtml = () => `<div class="flex flex-wrap items-end gap-3 mb-4 no-print">
    <label>De<input type="date" data-f="de" value="${filtro.de}" class="input" style="margin:0"></label>
    <label>Até<input type="date" data-f="ate" value="${filtro.ate}" class="input" style="margin:0"></label>
    <button class="btn-alt" data-act="limpar">Limpar</button>
    <span class="flex-1"></span><button class="btn-alt" data-act="imprimir">Imprimir / PDF</button></div>`;

  function desenhar() {
    raiz.querySelectorAll("[data-aba]").forEach((b) => b.classList.toggle("on", b.dataset.aba === aba));
    raiz.querySelector("#corpo").innerHTML = aba === "resumo" ? vResumo() : aba === "lanc" ? vLanc() : vConf();
  }

  // ---------- Prestação de contas ----------
  function vResumo() {
    const g = resumo(lancs, cfg.caixaInicial || 0);
    const p = resumo(lancs.filter(noPeriodo), 0);
    const kpi = (r, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${r}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;

    const total = g.devedorTotal;
    const linhas = socios.map((s) => {
      const x = g.soc[s.uid] || { emprestado: 0, despesasPagas: 0, reembolsado: 0, retiradas: 0, saldo: 0 };
      const ideal = r2(total * pct(s.uid) / 100);
      return { s, x, dif: r2(x.saldo - ideal) };
    });
    const equilibrio = linhas.length === 2 && total > 0
      ? (() => { const [a, b] = linhas; const mais = a.dif > 0 ? a : b; const menos = a.dif > 0 ? b : a;
          return Math.abs(a.dif) < 0.01 ? "Os empréstimos estão equilibrados com a divisão definida."
            : `<b>${esc(mais.s.nome)}</b> tem R$ ${num(Math.abs(mais.dif).toFixed(2))} a mais emprestado do que a cota. Para equilibrar, <b>${esc(menos.s.nome)}</b> colocaria ${brl(Math.abs(menos.dif))} (referência, sem efeito nos saldos).`; })()
      : "Sem empréstimos para comparar.";

    const porCat = {};
    lancs.filter((l) => l.tipo === "despesa" && noPeriodo(l)).forEach((l) => { porCat[l.categoria] = (porCat[l.categoria] || 0) + l.valor; });
    const cat = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const max = cat[0]?.[1] || 1;

    return periodoHtml() + `
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
        ${kpi("Saldo atual em caixa", brl(g.caixa), "considera todo o histórico")}
        ${kpi("Emprestado pelos sócios (a devolver)", brl(g.devedorTotal))}
        ${kpi("Entradas no período", brl(p.entradas))}
        ${kpi("Despesas no período", brl(p.despesas), "inclui as pagas do bolso dos sócios")}
        ${kpi("Retiradas no período", brl(p.retiradas))}
        ${kpi("Resultado do período", brl(p.entradas - p.despesas), "entradas menos despesas")}
      </div>
      <div class="card mb-4 overflow-x-auto"><h2 class="h2 mb-2">Conta dos sócios</h2>
        <table><tr><th>Sócio</th><th>Participação</th><th>Emprestou</th><th>Despesas pagas do bolso</th><th>Reembolsado</th><th>Saldo a receber</th><th>Retiradas</th></tr>
        ${linhas.map(({ s, x }) => `<tr><td><b>${esc(s.nome)}</b></td><td>${pct(s.uid)}%</td><td>${brl(x.emprestado)}</td><td>${brl(x.despesasPagas)}</td><td>${brl(x.reembolsado)}</td><td><b>${brl(x.saldo)}</b></td><td>${brl(x.retiradas)}</td></tr>`).join("")}</table>
        <p class="text-sm text-ink/70 mt-3">${equilibrio}</p>
        <p class="text-xs text-ink/70 mt-1">Empréstimos dos sócios não são capital social nem distribuição de lucros.</p>
      </div>
      <div class="card"><h2 class="h2 mb-2">Despesas por categoria (período)</h2>
        ${cat.length ? cat.map(([c, v]) => `<div class="mb-2"><div class="flex justify-between text-sm"><span>${esc(c)}</span><span>${brl(v)}</span></div>
          <div class="h-2 rounded-full bg-ink/10 overflow-hidden"><div class="h-full bg-brand" style="width:${(v / max) * 100}%"></div></div></div>`).join("") : '<p class="text-ink/70">Nenhuma despesa no período.</p>'}
      </div>`;
  }

  // ---------- Lançamentos ----------
  const lancFiltrados = () => lancs.filter((l) => noPeriodo(l) && (!filtro.tipo || l.tipo === filtro.tipo)
    && (!filtro.cat || l.categoria === filtro.cat) && (!filtro.socio || l.socioId === filtro.socio))
    .sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));

  function vLanc() {
    const lista = lancFiltrados();
    const entra = lista.filter((l) => ["entrada", "emprestimo"].includes(l.tipo)).reduce((s, l) => s + l.valor, 0);
    const sai = lista.filter((l) => !["entrada", "emprestimo"].includes(l.tipo)).reduce((s, l) => s + l.valor, 0);
    const cs = [...new Set(lancs.map((l) => l.categoria))].sort();
    return periodoHtml().replace('<span class="flex-1"></span>', "") + `
      <div class="flex flex-wrap gap-3 mb-4 no-print">
        <select data-f="tipo" class="input" style="width:auto;margin:0"><option value="">Todos os tipos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${filtro.tipo === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select data-f="cat" class="input" style="width:auto;margin:0"><option value="">Todas as categorias</option>${cs.map((c) => `<option ${filtro.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select data-f="socio" class="input" style="width:auto;margin:0"><option value="">Todos os sócios</option>${socios.map((s) => `<option value="${s.uid}" ${filtro.socio === s.uid ? "selected" : ""}>${esc(s.nome)}</option>`).join("")}</select>
        <button class="btn-alt" data-act="csv">Exportar CSV</button>
      </div>
      <p class="text-sm text-ink/70 mb-2">${lista.length} lançamentos · entradas ${brl(entra)} · saídas ${brl(sai)}</p>
      <div class="card overflow-x-auto">${!lista.length ? "Nenhum lançamento encontrado." : `<table>
        <tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Quem</th><th>Valor</th><th class="no-print"></th></tr>
        ${lista.map((l) => {
          const mais = ["entrada", "emprestimo"].includes(l.tipo);
          return `<tr><td>${fmtDia(l.data)}</td><td>${tagTipo(l.tipo)}</td>
            <td>${esc(l.descricao)}${l.obs ? `<br><small class="text-ink/70">${esc(l.obs)}</small>` : ""}${l.comprovante ? ` <a class="underline text-brand-dark text-sm" href="${esc(l.comprovante)}" target="_blank" rel="noopener">comprovante</a>` : ""}</td>
            <td>${esc(l.categoria)}${l.canal ? `<br><small class="text-ink/70">${l.canal}</small>` : ""}</td>
            <td>${l.cartaoId ? esc(l.cartaoNome || "Cartão da empresa") : l.socioNome ? esc(l.socioNome) + (l.tipo === "despesa" ? " (do bolso)" : "") : (l.sintetico ? "Fechamento do dia" : "Caixa")}</td>
            <td style="color:${mais ? "#1d7a46" : "inherit"}">${mais ? "+" : "−"} ${brl(l.valor)}</td>
            <td class="whitespace-nowrap no-print">${(["reembolso", "pagamento_fatura"].includes(l.tipo) || l.sintetico) ? "" : `<button class="btn-alt" data-act="ed" data-id="${l.id}">Editar</button> <button class="btn-alt" data-act="del" data-id="${l.id}">Excluir</button>`}</td></tr>`;
        }).join("")}</table>`}</div>`;
  }

  // ---------- Configurações ----------
  function vConf() {
    const ordem = ["despesa", "entrada", "retirada"];
    return `<div class="grid gap-4 lg:grid-cols-2">
      <form id="fCfg" class="card space-y-4 self-start"><h2 class="h2">Divisão societária e caixa inicial</h2>
        ${socios.map((s) => `<label>${esc(s.nome)} (%)<input name="p_${s.uid}" type="number" min="0" max="100" step="0.01" value="${pct(s.uid)}" class="input"></label>`).join("")}
        <label>Caixa inicial (R$)<input name="caixaInicial" inputmode="decimal" value="${num(cfg.caixaInicial || 0)}" class="input"></label>
        <p class="text-xs text-ink/70">A divisão é só referência para o equilíbrio entre os sócios. Pode ser alterada quando vocês decidirem.</p>
        <button class="btn">Salvar</button></form>
      <div class="card"><h2 class="h2 mb-2">Categorias</h2>
        <form id="fCat" class="flex gap-3 mb-3"><select name="tipo" class="input" style="width:auto;margin:0"><option value="despesa">Despesa</option><option value="entrada">Entrada</option><option value="retirada">Retirada</option></select>
          <input name="nome" required maxlength="60" class="input" style="margin:0" placeholder="Nova categoria"><button class="btn">Adicionar</button></form>
        ${ordem.map((t) => `<h3 class="font-bold mt-2">${TIPOS[t]}</h3><div class="flex flex-wrap gap-3 mt-1">${cats.filter((c) => c.tipo === t).sort((a, b) => a.nome.localeCompare(b.nome))
          .map((c) => `<span class="tag">${esc(c.nome)} <button data-act="delcat" data-id="${c.id}" aria-label="Remover ${esc(c.nome)}">×</button></span>`).join("")}</div>`).join("")}
      </div></div>`;
  }

  // ---------- Formulário de lançamento ----------
  function ajustarCampos(manter = {}) {
    const x = fL.elements, t = x.tipo.value;
    const mostrar = (n, on) => fL.querySelector(`[data-campo="${n}"]`).classList.toggle("hidden", !on);
    mostrar("socioId", COM_SOCIO.includes(t)); mostrar("canal", t === "entrada"); mostrar("categoria", t !== "emprestimo");
    raiz.querySelector("#rotSocio").textContent = t === "despesa" ? "Quem pagou" : t === "emprestimo" ? "Sócio que emprestou" : "Sócio que retirou";
    x.socioId.innerHTML = (t === "despesa" ? '<option value="">Caixa da empresa</option>' + cartoes.filter((c) => c.ativo !== false).map((c) => `<option value="cartao:${c.id}">${esc(c.nome)}</option>`).join("") : "") + socios.map((s) => `<option value="${s.uid}">${esc(s.nome)}</option>`).join("");
    x.categoria.innerHTML = cats.filter((c) => c.tipo === t).sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => `<option>${esc(c.nome)}</option>`).join("");
    if (manter.socioId !== undefined) x.socioId.value = manter.socioId;
    if (manter.categoria) x.categoria.value = manter.categoria;
    mostrarForma();
  }
  function mostrarForma() {   // a forma de pagamento só vale quando não é cartão nem do bolso do sócio
    const x = fL.elements, mostra = x.tipo.value === "despesa" && !x.socioId.value.startsWith("cartao:") && !x.socioId.value;
    fL.querySelector('[data-campo="forma"]').classList.toggle("hidden", !mostra);
  }

  function abrirForm(l) {
    editando = l || null;
    raiz.querySelector("#tL").textContent = l ? "Editar lançamento" : "Novo lançamento";
    fL.reset();
    const x = fL.elements;
    ["tipo", "data", "valor", "socioId", "forma"].forEach((n) => { x[n].disabled = !!l; });
    if (l) {
      x.tipo.value = l.tipo; ajustarCampos({ socioId: l.cartaoId ? "cartao:" + l.cartaoId : l.socioId, categoria: l.categoria });
      x.data.value = l.data; x.valor.value = num(l.valor); x.descricao.value = l.descricao;
      x.canal.value = l.canal || ""; x.comprovante.value = l.comprovante || ""; x.obs.value = l.obs || "";
    } else { x.data.value = hojeISO(); ajustarCampos(); }
    dL.showModal();
  }

  function exportarCSV() {
    const cab = ["Data", "Tipo", "Descrição", "Categoria", "Quem", "Canal", "Valor", "Comprovante", "Observações"];
    const linhas = lancFiltrados().map((l) => [l.data, TIPOS[l.tipo], l.descricao, l.categoria, l.socioNome || "Caixa", l.canal, num(l.valor), l.comprovante, l.obs].map(csvCel).join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + [cab.map(csvCel).join(";"), ...linhas].join("\r\n")], { type: "text/csv" }));
    a.download = "financeiro-alt-burguer.csv";
    a.click();
  }

  // ---------- Eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return desenhar(); }
    if (e.target.id === "novo") return abrirForm(null);
    if (e.target.id === "cancelarL") return dL.close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    try {
      const a = b.dataset.act;
      if (a === "limpar") { Object.assign(filtro, { de: "", ate: "", tipo: "", cat: "", socio: "" }); desenhar(); }
      else if (a === "imprimir") window.print();
      else if (a === "csv") exportarCSV();
      else if (a === "ed") abrirForm(lancs.find((x) => x.id === b.dataset.id));
      else if (a === "del") {
        const l = lancs.find((x) => x.id === b.dataset.id);
        if (confirm(`Excluir o lançamento "${l.descricao}" de ${brl(l.valor)}? Fica registrado no histórico de alterações.`)) {
          await deleteDoc(doc(db, "lancamentos", l.id));
          await auditar(perfil, "lancamento_excluido", `${TIPOS[l.tipo]} ${brl(l.valor)} em ${l.data}: ${l.descricao} (${l.socioNome || "Caixa"})`);
          toast("Lançamento excluído.");
        }
      } else if (a === "delcat") {
        const c = cats.find((x) => x.id === b.dataset.id);
        if (confirm(`Remover a categoria "${c.nome}"? Lançamentos antigos continuam com ela.`)) await deleteDoc(doc(db, "categorias_fin", c.id));
      }
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  raiz.addEventListener("change", (e) => {
    if (e.target.name === "tipo" && e.target.closest("#fL")) return ajustarCampos();
    if (e.target.name === "socioId" && e.target.closest("#fL")) return mostrarForma();
    const k = e.target.dataset.f;
    if (k) { filtro[k] = e.target.value; desenhar(); }
  });

  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.id;
    try {
      if (id === "fL") {
        const d = Object.fromEntries(new FormData(fL));
        const comprovante = (d.comprovante || "").trim();
        if (comprovante && !/^https?:\/\//i.test(comprovante)) return toast("O link do comprovante deve começar com http:// ou https://");
        if (editando) {
          const l = editando;
          await updateDoc(doc(db, "lancamentos", l.id), {
            descricao: d.descricao.trim(), categoria: l.tipo === "emprestimo" ? l.categoria : (d.categoria || l.categoria),
            canal: l.tipo === "entrada" ? d.canal : "", comprovante, obs: d.obs.trim(), atualizadoEm: serverTimestamp()
          });
          await auditar(perfil, "lancamento_editado", `${l.descricao} → ${d.descricao.trim()}`);
        } else {
          const t = d.tipo, valor = parseBRL(d.valor);
          if (!(valor > 0)) return toast("Informe um valor válido.");
          const raw = COM_SOCIO.includes(t) ? (d.socioId || "") : "", cartaoSel = raw.startsWith("cartao:") ? cartoes.find((c) => c.id === raw.slice(7)) : null, socioId = cartaoSel ? "" : raw;
          if (t !== "despesa" && COM_SOCIO.includes(t) && !socioId) return toast("Escolha o sócio.");
          await addDoc(collection(db, "lancamentos"), {
            tipo: t, data: d.data, descricao: d.descricao.trim(), categoria: t === "emprestimo" ? "Empréstimo do sócio" : (d.categoria || "Outros"),
            valor: r2(valor), socioId, socioNome: socioId ? nomeSocio(socioId) : "", cartaoId: cartaoSel?.id || "", cartaoNome: cartaoSel?.nome || "",
            forma: t === "despesa" ? (cartaoSel ? "cartao" : socioId ? "" : d.forma || "") : "", canal: t === "entrada" ? d.canal : "",
            comprovante, obs: d.obs.trim(), criadoPor: auth.currentUser.uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp()
          });
          await auditar(perfil, "lancamento_criado", `${TIPOS[t]} ${brl(valor)}: ${d.descricao.trim()} (${cartaoSel ? cartaoSel.nome : socioId ? nomeSocio(socioId) : "Caixa"})`);
        }
        dL.close(); toast("Lançamento salvo.");
      } else if (id === "fCfg") {
        const d = Object.fromEntries(new FormData(e.target));
        const divisao = {};
        socios.forEach((s) => { divisao[s.uid] = Number(d["p_" + s.uid]); });
        const soma = Object.values(divisao).reduce((a, b) => a + b, 0);
        const caixaInicial = parseBRL(d.caixaInicial || "0");
        if (Math.abs(soma - 100) > 0.01) return toast(`A divisão precisa somar 100% (agora soma ${soma}%).`);
        if (isNaN(caixaInicial) || caixaInicial < 0) return toast("Caixa inicial inválido.");
        await setDoc(doc(db, "config", "geral"), { divisao, caixaInicial: r2(caixaInicial) }, { merge: true });
        await auditar(perfil, "config_financeira", `Divisão ${socios.map((s) => `${s.nome} ${divisao[s.uid]}%`).join(" / ")}; caixa inicial ${brl(caixaInicial)}`);
        toast("Configurações salvas.");
      } else if (id === "fCat") {
        const d = Object.fromEntries(new FormData(e.target));
        await setDoc(doc(db, "categorias_fin", `${d.tipo}_${slug(d.nome)}`), { tipo: d.tipo, nome: d.nome.trim() });
        e.target.reset();
      }
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  const erro = (e) => { console.error(e); toast(traduzErro(e)); };
  const paradas = [
    onSnapshot(collection(db, "lancamentos"), (s) => { lancsBase = s.docs.map((d) => ({ id: d.id, ...d.data() })); lancs = [...lancsBase, ...extras]; desenhar(); }, erro),
    assinarEntradas((x) => { extras = x; lancs = [...lancsBase, ...extras]; desenhar(); }, erro),   // entradas do fechamento diário
    onSnapshot(collection(db, "cartoes"), (s) => { cartoes = s.docs.map((d) => ({ id: d.id, ...d.data() })); }, erro),
    onSnapshot(doc(db, "config", "geral"), (s) => { cfg = s.exists() ? s.data() : {}; desenhar(); }, erro),
    onSnapshot(collection(db, "categorias_fin"), async (s) => {
      cats = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!cats.length && !semeou) { // primeira vez: cria as categorias padrão (ids fixos, sem duplicar)
        semeou = true;
        const lote = writeBatch(db);
        CATEGORIAS_PADRAO.forEach(([tipo, nome]) => lote.set(doc(db, "categorias_fin", `${tipo}_${slug(nome)}`), { tipo, nome }));
        try { await lote.commit(); } catch (err) { erro(err); }
      }
      desenhar();
    }, erro)
  ];
  desenhar();
  return () => paradas.forEach((p) => p());
}
