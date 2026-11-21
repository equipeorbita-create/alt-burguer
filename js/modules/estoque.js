import { db, auth } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia, fmtData } from "../util.js";
import { r2, carregarSocios } from "../core/financas.js";
import { r3, estoqueDe, ordemPEPS, baixarPEPS, ajustarContagem, parseQtd, numero, diasAte, MOTIVOS } from "../core/estoque.js";
import { lerCodigo } from "../core/scanner.js";
import { qrSvg, imprimirEtiquetas, htmlEtiqueta } from "../core/etiquetas.js";
import {
  collection, doc, onSnapshot, getDocs, query, where, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TIPO_MOV = { compra: "Compra", baixa: "Saída", descarte: "Descarte", ajuste: "Ajuste", producao: "Produção" };
const fq = (n, u) => `${String(r3(n)).replace(".", ",")} ${u}`;
const num = (n) => String(n ?? "").replace(".", ",");
const ERROS = {
  SEM_ESTOQUE: "Não há estoque suficiente para essa quantidade.",
  ESTOQUE_MUDOU: "O estoque mudou enquanto você registrava. Confira a quantidade e tente de novo.",
  SCRIPT_FALHOU: "Não foi possível carregar o leitor. Verifique a internet e tente de novo."
};
const erro = (e) => { console.error(e); toast(ERROS[e.message] || traduzErro(e)); };

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  const operacional = admin || perfil.papel === "gerente";
  const socios = admin ? await carregarSocios() : [];
  const nomeSocio = (id) => (socios.find((s) => s.uid === id) || {}).nome || "";

  let insumos = [], lotes = [], custos = {}, movs = [];
  let aba = operacional ? "insumos" : "baixa";
  const f = { q: "", cat: "", alerta: false, mq: "", mt: "" };
  const sel = { baixa: "", contagem: "" };
  let compra = { data: hojeISO(), local: "", pagoPor: "", lancar: true, itens: [] };
  let editando = null, recentes = [];

  const ABAS = [["insumos", "Insumos"], ...(admin ? [["compra", "Compra rápida"]] : []), ["baixa", "Baixa"],
    ...(operacional ? [["contagem", "Contagem"], ["mov", "Movimentações"]] : [])];

  el.innerHTML = `<div id="raiz">
    <div id="abas" class="flex flex-wrap gap-3 mb-5"></div>
    <div id="corpo"></div>
    <dialog id="dI"><form id="fI" class="space-y-4">
      <h2 class="h2" id="tI"></h2>
      <label>Nome<input name="nome" required maxlength="120" class="input" placeholder="Ex.: Blend bovino 150 g"></label>
      <label>Categoria<input name="categoria" maxlength="60" list="cats" class="input" placeholder="Carnes, Pães, Molhos, Embalagens..."></label><datalist id="cats"></datalist>
      <div class="grid grid-cols-2 gap-4">
        <label>Unidade de medida<select name="unidade" class="input"><option value="g">Gramas (g)</option><option value="ml">Mililitros (ml)</option><option value="un">Unidades (un)</option></select></label>
        <label>Qtd. por embalagem<input name="qtdEmbalagem" required inputmode="decimal" class="input" placeholder="Ex.: 5000"></label>
        <label>Preço da embalagem (R$)<input name="precoEmbalagem" required inputmode="decimal" class="input" placeholder="165,00"></label>
        <label>Estoque mínimo<input name="estoqueMinimo" required inputmode="decimal" class="input" placeholder="Ex.: 3000"></label>
      </div>
      <label>Código de barras de fábrica (opcional)<input name="ean" maxlength="30" inputmode="numeric" class="input"></label>
      <div data-novo class="grid grid-cols-2 gap-4">
        <label>Estoque inicial<input name="estoqueInicial" inputmode="decimal" class="input" placeholder="0"></label>
        <label>Validade do estoque inicial<input name="validadeInicial" type="date" class="input"></label>
      </div>
      <label data-edicao class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="ativo" checked> Insumo ativo</label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dI" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>
    <dialog id="dX"></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo");
  const dI = raiz.querySelector("#dI"), fI = raiz.querySelector("#fI"), dX = raiz.querySelector("#dX");
  const ativos = () => insumos.filter((i) => i.ativo !== false);
  const achar = (cod) => ativos().find((i) => i.qr === cod.trim() || (i.ean && i.ean === cod.trim()));
  const estoque = (i) => estoqueDe(lotes, i.id);
  const proxVal = (i) => lotes.filter((l) => l.insumoId === i.id && l.validade).map((l) => l.validade).sort()[0];
  const opcoes = (lista, atual) => `<option value="">Escolha o insumo...</option>` + lista.sort((a, b) => a.nome.localeCompare(b.nome))
    .map((i) => `<option value="${i.id}" ${i.id === atual ? "selected" : ""}>${esc(i.nome)} · ${fq(estoque(i), i.unidade)}</option>`).join("");
  const tagVal = (v) => {
    if (!v) return "—";
    const d = diasAte(v);
    if (d < 0) return `<span class="tag bad">Vencido ${fmtDia(v)}</span>`;
    if (d <= 7) return `<span class="tag" style="background:#ffb067">Vence em ${d}d (${fmtDia(v)})</span>`;
    return fmtDia(v);
  };

  // ---------- montagem das abas (uma vez) e atualização dos dados (a cada mudança) ----------
  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    corpo.innerHTML = ({ insumos: mInsumos, compra: mCompra, baixa: mBaixa, contagem: mContagem, mov: mMov }[aba])();
    atualizar();
  }
  function atualizar() { ({ insumos: aInsumos, compra: aCompra, baixa: aBaixa, contagem: aContagem, mov: aMov }[aba])(); }

  // ===== Insumos =====
  const mInsumos = () => `
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input id="fq" class="input" style="width:14rem;margin:0" placeholder="Buscar insumo..." value="${esc(f.q)}">
      <select id="fcat" class="input" style="width:auto;margin:0"></select>
      <label class="flex items-center gap-2" style="margin:0;font-size:1rem"><input type="checkbox" id="fal" ${f.alerta ? "checked" : ""}> Só alertas</label>
      <span class="flex-1"></span>
      ${admin ? `<button class="btn-alt" data-act="etqs">Etiquetas de todos</button><button class="btn" data-act="novoI">Novo insumo</button>` : ""}
    </div>
    <div id="kpis" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5"></div><div id="lista"></div>`;

  function aInsumos() {
    const cats = [...new Set(ativos().map((i) => i.categoria).filter(Boolean))].sort();
    raiz.querySelector("#fcat").innerHTML = `<option value="">Todas as categorias</option>` + cats.map((c) => `<option ${f.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    raiz.querySelector("#cats").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
    const todos = ativos();
    const baixos = todos.filter((i) => estoque(i) < i.estoqueMinimo);
    const vencendo = lotes.filter((l) => l.validade && diasAte(l.validade) <= 7);
    const valor = admin ? lotes.reduce((s, l) => s + l.qtdAtual * (custos[l.insumoId]?.custoUnitario || 0), 0) : 0;
    const kpi = (r, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${r}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
    raiz.querySelector("#kpis").innerHTML = kpi("Insumos ativos", todos.length) + kpi("Abaixo do mínimo", baixos.length) +
      kpi("Lotes vencendo (7 dias)", vencendo.length) + (admin ? kpi("Valor em estoque", brl(valor)) : "");

    const q = f.q.trim().toLowerCase();
    const lista = todos.filter((i) => (!q || `${i.nome} ${i.categoria || ""}`.toLowerCase().includes(q)) && (!f.cat || i.categoria === f.cat)
      && (!f.alerta || estoque(i) < i.estoqueMinimo || (proxVal(i) && diasAte(proxVal(i)) <= 7))).sort((a, b) => a.nome.localeCompare(b.nome));
    raiz.querySelector("#lista").innerHTML = !lista.length
      ? `<div class="card">${insumos.length ? "Nenhum insumo encontrado." : admin ? "Nenhum insumo cadastrado ainda. Toque em \"Novo insumo\"." : "Nenhum insumo cadastrado ainda."}</div>`
      : `<div class="card"><table><tr><th>Insumo</th><th>Estoque</th><th>Mínimo</th><th>Validade</th>${admin ? "<th>Custo</th>" : ""}<th></th></tr>
        ${lista.map((i) => {
          const e = estoque(i), st = e <= 0 ? '<span class="tag bad">Sem estoque</span>' : e < i.estoqueMinimo ? '<span class="tag bad">Baixo</span>' : '<span class="tag ok">OK</span>';
          const c = custos[i.id];
          return `<tr><td><b>${esc(i.nome)}</b>${i.categoria ? `<br><small class="text-ink/70">${esc(i.categoria)}</small>` : ""}</td>
            <td>${fq(e, i.unidade)} ${st}</td><td>${fq(i.estoqueMinimo, i.unidade)}</td><td>${tagVal(proxVal(i))}</td>
            ${admin ? `<td>${c ? `${brl(c.custoUnitario)}/${i.unidade}<br><small class="text-ink/70">emb. ${brl(c.precoEmbalagem)}</small>` : "—"}</td>` : ""}
            <td class="whitespace-nowrap"><button class="btn-alt" data-act="lotes" data-id="${i.id}">Lotes</button>
              <button class="btn-alt" data-act="etq" data-id="${i.id}">Etiqueta</button>
              ${admin ? `<button class="btn-alt" data-act="precos" data-id="${i.id}">Preços</button><button class="btn-alt" data-act="editI" data-id="${i.id}">Editar</button>` : ""}</td></tr>`;
        }).join("")}</table></div>`;
  }

  function abrirInsumo(i) {
    editando = i || null;
    raiz.querySelector("#tI").textContent = i ? "Editar insumo" : "Novo insumo";
    fI.reset();
    fI.querySelector("[data-novo]").classList.toggle("hidden", !!i);
    fI.querySelector("[data-edicao]").classList.toggle("hidden", !i);
    const x = fI.elements; x.unidade.disabled = !!i;
    if (i) {
      const c = custos[i.id] || {};
      x.nome.value = i.nome; x.categoria.value = i.categoria || ""; x.unidade.value = i.unidade; x.qtdEmbalagem.value = num(i.qtdEmbalagem);
      x.precoEmbalagem.value = num(c.precoEmbalagem ?? 0); x.estoqueMinimo.value = num(i.estoqueMinimo); x.ean.value = i.ean || ""; x.ativo.checked = i.ativo !== false;
    }
    dI.showModal();
  }

  async function salvarInsumo() {
    const d = Object.fromEntries(new FormData(fI));
    const emb = numero(d.qtdEmbalagem), preco = parseBRL(d.precoEmbalagem), min = numero(d.estoqueMinimo || "0");
    if (!(emb > 0) || isNaN(preco) || preco < 0 || isNaN(min)) return toast("Confira a quantidade por embalagem, o preço e o mínimo.");
    const custoUn = preco / emb, lote = writeBatch(db), base = { nome: d.nome.trim(), categoria: d.categoria.trim(), qtdEmbalagem: emb, estoqueMinimo: min, ean: d.ean.trim() };
    const preco2 = (insumoId, local) => {
      lote.set(doc(db, "insumos_custos", insumoId), { precoEmbalagem: r2(preco), custoUnitario: custoUn, atualizadoEm: serverTimestamp() }, { merge: true });
      lote.set(doc(collection(db, "insumos_custos", insumoId, "historico")), { data: hojeISO(), precoEmbalagem: r2(preco), custoUnitario: custoUn, local, criadoEm: serverTimestamp() });
    };
    if (editando) {
      const c = custos[editando.id] || {};
      lote.update(doc(db, "insumos", editando.id), { ...base, qr: editando.qr, unidade: editando.unidade, ativo: !!d.ativo, atualizadoEm: serverTimestamp() });
      if (c.precoEmbalagem !== r2(preco) || editando.qtdEmbalagem !== emb) preco2(editando.id, "Ajuste manual");
      await lote.commit();
      await auditar(perfil, "insumo_editado", base.nome);
    } else {
      const ref = doc(collection(db, "insumos")), qr = "ALT-" + ref.id.slice(0, 6).toUpperCase(), un = d.unidade;
      lote.set(ref, { ...base, unidade: un, qr, ativo: true, criadoEm: serverTimestamp() });
      preco2(ref.id, "Cadastro inicial");
      const ini = d.estoqueInicial ? numero(d.estoqueInicial) : 0;
      if (ini > 0) {
        const lr = doc(collection(db, "lotes"));
        lote.set(lr, { insumoId: ref.id, qtdInicial: r3(ini), qtdAtual: r3(ini), validade: d.validadeInicial || "", entradaEm: hojeISO(), origem: "inicial", criadoPor: auth.currentUser.uid, criadoEm: serverTimestamp() });
        lote.set(doc(collection(db, "movimentacoes")), { tipo: "ajuste", insumoId: ref.id, insumoNome: base.nome, unidade: un, delta: r3(ini), lotes: [{ loteId: lr.id, qtd: r3(ini) }], motivo: "inicial", obs: "Estoque inicial", por: auth.currentUser.uid, porNome: perfil.nome, em: serverTimestamp() });
      }
      await lote.commit();
      await auditar(perfil, "insumo_criado", base.nome);
    }
    dI.close(); toast("Insumo salvo.");
  }

  async function verEtiqueta(i) {
    dX.innerHTML = `<h2 class="h2 mb-3">Etiqueta</h2><div class="text-center"><p>Gerando QR…</p></div>`; dX.showModal();
    try {
      const svg = await qrSvg(i.qr);
      dX.innerHTML = `<h2 class="h2 mb-3">Etiqueta</h2><div class="etq mx-auto" style="max-width:15rem">${htmlEtiqueta(i, svg).replace(/^<div class="etq">|<\/div>$/g, "")}</div>
        <div class="flex gap-3 justify-end mt-5"><button type="button" data-fechar="dX" class="btn-alt">Fechar</button><button type="button" class="btn" data-act="imprimir1" data-id="${i.id}">Imprimir</button></div>`;
    } catch (e) { dX.close(); erro(e); }
  }

  function verLotes(i) {
    const ls = lotes.filter((l) => l.insumoId === i.id).sort(ordemPEPS);
    dX.innerHTML = `<h2 class="h2 mb-1">${esc(i.nome)}</h2><p class="text-ink/70 mb-3">Em estoque: <b>${fq(estoque(i), i.unidade)}</b>. A saída segue a ordem abaixo (vence primeiro, sai primeiro).</p>
      <table><tr><th>Validade</th><th>Saldo</th><th>Entrada</th><th>Origem</th></tr>
      ${ls.map((l) => `<tr><td>${tagVal(l.validade) === "—" ? "Sem validade" : tagVal(l.validade)}</td><td>${fq(l.qtdAtual, i.unidade)} <small class="text-ink/70">de ${fq(l.qtdInicial, i.unidade)}</small></td><td>${fmtDia(l.entradaEm)}</td><td>${esc(l.origem || "")}</td></tr>`).join("") || '<tr><td colspan="4">Sem lotes com saldo.</td></tr>'}</table>
      <div class="flex justify-end mt-5"><button type="button" data-fechar="dX" class="btn-alt">Fechar</button></div>`;
    dX.showModal();
  }

  async function verPrecos(i) {
    dX.innerHTML = `<h2 class="h2 mb-3">Preços · ${esc(i.nome)}</h2><p>Carregando…</p>`; dX.showModal();
    try {
      const s = await getDocs(query(collection(db, "insumos_custos", i.id, "historico"), orderBy("data", "desc"), limit(30)));
      dX.innerHTML = `<h2 class="h2 mb-3">Preços · ${esc(i.nome)}</h2><table><tr><th>Data</th><th>Embalagem</th><th>Por ${i.unidade}</th><th>Origem</th></tr>
        ${s.docs.map((d) => d.data()).map((h) => `<tr><td>${fmtDia(h.data)}</td><td>${brl(h.precoEmbalagem)}</td><td>${brl(h.custoUnitario)}</td><td>${esc(h.local || "")}</td></tr>`).join("") || '<tr><td colspan="4">Sem registros.</td></tr>'}</table>
        <div class="flex justify-end mt-5"><button type="button" data-fechar="dX" class="btn-alt">Fechar</button></div>`;
    } catch (e) { dX.close(); erro(e); }
  }

  // ===== Compra rápida (só sócios) =====
  const mCompra = () => `<div class="card" style="max-width:44rem">
    <p class="text-ink/70 mb-4">Lance a compra do dia. Ao salvar: o estoque sobe (com a validade de cada lote), o custo dos insumos é atualizado e, se marcado, a despesa vai para o Financeiro.</p>
    <div class="grid grid-cols-2 gap-4">
      <label>Data<input id="cdata" type="date" class="input" value="${compra.data}"></label>
      <label>Local / fornecedor<input id="clocal" class="input" placeholder="Ex.: Atacadão" value="${esc(compra.local)}"></label>
      <label>Quem pagou<select id="cpago" class="input"><option value="">Caixa da empresa</option>${socios.map((s) => `<option value="${s.uid}" ${compra.pagoPor === s.uid ? "selected" : ""}>${esc(s.nome)} (do bolso)</option>`).join("")}</select></label>
      <label class="flex items-center gap-3" style="align-self:end;min-height:48px;font-size:1rem;color:inherit"><input type="checkbox" id="clancar" ${compra.lancar ? "checked" : ""}> Lançar no Financeiro</label>
    </div>
    <h3 class="h2 mt-6 mb-3">Itens comprados</h3>
    <div id="citens"></div>
    <div class="flex flex-wrap gap-3 mt-2"><button class="btn-alt" data-act="additem">+ Adicionar item</button><button class="btn-alt" data-act="lerc">Ler código</button></div>
    <p class="mt-5 text-lg">Total: <b id="ctotal"></b></p>
    <button class="btn w-full mt-3" data-act="salvarcompra">Salvar compra</button></div>`;

  function aCompra() {
    const c = raiz.querySelector("#citens");
    c.innerHTML = compra.itens.map((it, n) => `<div class="card mb-4" data-n="${n}">
      <label>Insumo<select data-ci="${n}" data-k="insumoId" class="input">${opcoes(ativos(), it.insumoId)}</select></label>
      <div class="grid grid-cols-2 gap-4 mt-3">
        <label>Nº de embalagens<input data-ci="${n}" data-k="emb" inputmode="decimal" class="input" value="${esc(it.emb)}"></label>
        <label>Valor total pago (R$)<input data-ci="${n}" data-k="valor" inputmode="decimal" class="input" value="${esc(it.valor)}"></label>
      </div>
      <label class="mt-3">Validade do lote<input data-ci="${n}" data-k="validade" type="date" class="input" value="${it.validade}"></label>
      <p class="text-sm text-ink/70 mt-3" id="cinfo${n}"></p>
      <button class="btn-alt mt-3" data-act="remitem" data-n="${n}">Remover item</button></div>`).join("") || '<p class="text-ink/70 mb-3">Nenhum item ainda. Toque em "Adicionar item" ou "Ler código".</p>';
    compra.itens.forEach((_, n) => infoItem(n));
    totalCompra();
  }
  function infoItem(n) {
    const it = compra.itens[n], ins = insumos.find((i) => i.id === it.insumoId), e = raiz.querySelector(`#cinfo${n}`);
    if (!e) return;
    const emb = numero(it.emb || "0"), val = parseBRL(it.valor || "0");
    e.textContent = ins && emb > 0 && val > 0 ? `Entra no estoque: ${fq(emb * ins.qtdEmbalagem, ins.unidade)} · novo custo ${brl(val / (emb * ins.qtdEmbalagem))}/${ins.unidade}` : "";
  }
  function totalCompra() {
    const t = compra.itens.reduce((s, it) => s + (parseBRL(it.valor || "0") || 0), 0);
    const e = raiz.querySelector("#ctotal"); if (e) e.textContent = brl(t);
  }

  async function salvarCompra() {
    const c = compra;
    if (!c.itens.length) return toast("Adicione ao menos um item.");
    if (c.itens.length > 50) return toast("No máximo 50 itens por compra.");
    const lote = writeBatch(db), compraRef = doc(collection(db, "compras")), itens = [];
    let total = 0;
    for (const it of c.itens) {
      const ins = insumos.find((i) => i.id === it.insumoId), nEmb = numero(it.emb || "0"), val = parseBRL(it.valor || "0");
      if (!ins) return toast("Escolha o insumo em todos os itens.");
      if (!(nEmb > 0) || !(val > 0)) return toast(`Confira a quantidade e o valor de "${ins.nome}".`);
      const base = r3(nEmb * ins.qtdEmbalagem), lr = doc(collection(db, "lotes")), custoUn = val / base, preco = r2(val / nEmb);
      lote.set(lr, { insumoId: ins.id, qtdInicial: base, qtdAtual: base, validade: it.validade || "", entradaEm: c.data, origem: "compra", compraId: compraRef.id, criadoPor: auth.currentUser.uid, criadoEm: serverTimestamp() });
      lote.set(doc(db, "insumos_custos", ins.id), { precoEmbalagem: preco, custoUnitario: custoUn, atualizadoEm: serverTimestamp() }, { merge: true });
      lote.set(doc(collection(db, "insumos_custos", ins.id, "historico")), { data: c.data, precoEmbalagem: preco, custoUnitario: custoUn, local: c.local || "Compra", compraId: compraRef.id, criadoEm: serverTimestamp() });
      lote.set(doc(collection(db, "movimentacoes")), { tipo: "compra", insumoId: ins.id, insumoNome: ins.nome, unidade: ins.unidade, delta: base, lotes: [{ loteId: lr.id, qtd: base }], motivo: "", obs: c.local || "", por: auth.currentUser.uid, porNome: perfil.nome, em: serverTimestamp() });
      itens.push({ insumoId: ins.id, nome: ins.nome, qtdEmbalagens: nEmb, qtdBase: base, valor: r2(val), validade: it.validade || "", loteId: lr.id });
      total += val;
    }
    total = r2(total);
    lote.set(compraRef, { data: c.data, local: c.local, itens, total, pagoPor: c.pagoPor, despesaLancada: !!c.lancar, criadoPor: auth.currentUser.uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp() });
    if (c.lancar) lote.set(doc(collection(db, "lancamentos")), {
      tipo: "despesa", data: c.data, descricao: `Compra de insumos${c.local ? ` (${c.local})` : ""}`, categoria: "Insumos", valor: total,
      socioId: c.pagoPor, socioNome: c.pagoPor ? nomeSocio(c.pagoPor) : "", canal: "", comprovante: "", obs: `${itens.length} itens`, compraId: compraRef.id,
      criadoPor: auth.currentUser.uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp()
    });
    await lote.commit();
    await auditar(perfil, "compra_registrada", `${itens.length} itens, ${brl(total)}${c.local ? " em " + c.local : ""}`);
    compra = { data: hojeISO(), local: "", pagoPor: "", lancar: true, itens: [] };
    toast("Compra registrada.");
    montar();
  }

  // ===== Baixa =====
  const mBaixa = () => `<div class="card" style="max-width:34rem">
    <button class="btn w-full" style="min-height:64px" data-act="ler" data-alvo="baixa">Ler QR / código de barras</button>
    <label class="mt-5">Buscar pelo nome<input id="bq" class="input" placeholder="Digite parte do nome..."></label>
    <label class="mt-4">Insumo<select id="bsel" class="input"></select></label>
    <div id="binfo" class="mt-3"></div>
    <label class="mt-4">Quantidade retirada<input id="bqtd" class="input qtd-grande" inputmode="decimal" placeholder="Ex.: 500 ou 2 kg" autocomplete="off"></label>
    <label class="mt-4">Motivo<select id="bmot" class="input">${Object.entries(MOTIVOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="mt-4">Observação (opcional)<input id="bobs" class="input" maxlength="120"></label>
    <button class="btn w-full mt-5" style="min-height:58px" data-act="baixar">Registrar saída</button></div>
    <div class="card mt-5" style="max-width:34rem"><h3 class="h2 mb-2">Registrado agora</h3><div id="brec"></div></div>`;

  function aBaixa() {
    const q = (raiz.querySelector("#bq")?.value || "").trim().toLowerCase();
    const lista = ativos().filter((i) => !q || i.nome.toLowerCase().includes(q) || i.id === sel.baixa);
    raiz.querySelector("#bsel").innerHTML = opcoes(lista, sel.baixa);
    const i = insumos.find((x) => x.id === sel.baixa), info = raiz.querySelector("#binfo");
    info.innerHTML = i ? `<p>Em estoque: <b>${fq(estoque(i), i.unidade)}</b>${proxVal(i) ? `<br><small class="text-ink/70">Sai primeiro o lote que vence em ${fmtDia(proxVal(i))}</small>` : ""}</p>` : "";
    raiz.querySelector("#brec").innerHTML = recentes.map((r) => `<p class="py-1">✔ <b>${esc(r.nome)}</b> · ${esc(r.qtd)} <small class="text-ink/70">${r.hora}</small></p>`).join("") || '<p class="text-ink/70">Nada registrado ainda.</p>';
  }

  async function baixar() {
    const i = insumos.find((x) => x.id === sel.baixa);
    if (!i) return toast("Escolha o insumo.");
    const r = parseQtd(raiz.querySelector("#bqtd").value, i.unidade);
    if (r.erro) return toast(r.erro);
    const motivo = raiz.querySelector("#bmot").value;
    await baixarPEPS({ insumo: i, qtd: r.valor, tipo: motivo === "descarte" ? "descarte" : "baixa", motivo, obs: raiz.querySelector("#bobs").value.trim(), perfil, lotes });
    recentes.unshift({ nome: i.nome, qtd: `−${fq(r.valor, i.unidade)}`, hora: new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }) });
    recentes = recentes.slice(0, 8);
    raiz.querySelector("#bqtd").value = ""; raiz.querySelector("#bobs").value = "";
    toast(`Saída registrada: ${fq(r.valor, i.unidade)} de ${i.nome}`);
    aBaixa();
  }

  // ===== Contagem =====
  const mContagem = () => `<div class="card" style="max-width:34rem">
    <p class="text-ink/70 mb-4">Conte o que existe de verdade na prateleira. O sistema corrige a diferença e registra o ajuste.</p>
    <button class="btn w-full" style="min-height:58px" data-act="ler" data-alvo="contagem">Ler QR / código de barras</button>
    <label class="mt-5">Insumo<select id="ksel" class="input"></select></label>
    <div id="kinfo" class="mt-3"></div>
    <label class="mt-4">Quantidade contada<input id="kqtd" class="input qtd-grande" inputmode="decimal" placeholder="Ex.: 3500 ou 3,5 kg" autocomplete="off"></label>
    <label class="mt-4">Observação (opcional)<input id="kobs" class="input" maxlength="120"></label>
    <button class="btn w-full mt-5" data-act="contar">Ajustar estoque</button></div>`;
  function aContagem() {
    raiz.querySelector("#ksel").innerHTML = opcoes(ativos(), sel.contagem);
    const i = insumos.find((x) => x.id === sel.contagem);
    raiz.querySelector("#kinfo").innerHTML = i ? `<p>O sistema indica: <b>${fq(estoque(i), i.unidade)}</b></p>` : "";
  }
  async function contar() {
    const i = insumos.find((x) => x.id === sel.contagem);
    if (!i) return toast("Escolha o insumo.");
    const txt = raiz.querySelector("#kqtd").value.trim();
    const r = txt === "0" ? { valor: 0 } : parseQtd(txt, i.unidade);
    if (r.erro) return toast(r.erro);
    const sis = estoque(i), dif = r3(r.valor - sis);
    if (dif === 0) return toast("A contagem confere com o sistema. Nada a ajustar.");
    if (!confirm(`${i.nome}\nSistema: ${fq(sis, i.unidade)}\nContado: ${fq(r.valor, i.unidade)}\nDiferença: ${dif > 0 ? "+" : ""}${fq(dif, i.unidade)}\n\nConfirmar o ajuste?`)) return;
    await ajustarContagem({ insumo: i, contado: r.valor, obs: raiz.querySelector("#kobs").value.trim(), perfil, lotes });
    await auditar(perfil, "estoque_ajustado", `${i.nome}: ${fq(sis, i.unidade)} → ${fq(r.valor, i.unidade)}`);
    raiz.querySelector("#kqtd").value = ""; raiz.querySelector("#kobs").value = "";
    toast("Estoque ajustado.");
  }

  // ===== Movimentações =====
  const mMov = () => `<div class="flex flex-wrap gap-3 mb-4">
    <input id="mq" class="input" style="width:14rem;margin:0" placeholder="Buscar insumo ou pessoa..." value="${esc(f.mq)}">
    <select id="mt" class="input" style="width:auto;margin:0"><option value="">Todos os tipos</option>${Object.entries(TIPO_MOV).map(([k, v]) => `<option value="${k}" ${f.mt === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div id="mlista"></div><p class="text-xs text-ink/70 mt-2">Últimas 200 movimentações.</p>`;
  function aMov() {
    const q = f.mq.trim().toLowerCase();
    const l = movs.filter((m) => (!f.mt || m.tipo === f.mt) && (!q || `${m.insumoNome} ${m.porNome}`.toLowerCase().includes(q)));
    raiz.querySelector("#mlista").innerHTML = !l.length ? '<div class="card">Nenhuma movimentação.</div>' : `<div class="card"><table>
      <tr><th>Data e hora</th><th>Tipo</th><th>Insumo</th><th>Quantidade</th><th>Quem</th></tr>
      ${l.map((m) => `<tr><td>${fmtData(m.em)}</td><td><span class="tag ${m.delta > 0 ? "ok" : ""}">${TIPO_MOV[m.tipo] || m.tipo}</span></td>
        <td>${esc(m.insumoNome)}${m.obs ? `<br><small class="text-ink/70">${esc(m.obs)}</small>` : ""}</td>
        <td style="color:${m.delta > 0 ? "#1d7a46" : "#B8470B"}"><b>${m.delta > 0 ? "+" : "−"}${fq(Math.abs(m.delta), m.unidade)}</b></td><td>${esc(m.porNome)}</td></tr>`).join("")}</table></div>`;
  }

  // ---------- eventos ----------
  const aplicarCodigo = async (alvo) => {
    const cod = await lerCodigo("Ler código do insumo");
    if (!cod) return;
    const i = achar(cod);
    if (!i) return toast(`Código "${cod}" não está cadastrado.`);
    if (alvo === "compra") { compra.itens.push({ insumoId: i.id, emb: "1", valor: "", validade: "" }); aCompra(); return toast(i.nome); }
    sel[alvo] = i.id; (alvo === "baixa" ? aBaixa : aContagem)();
    raiz.querySelector(alvo === "baixa" ? "#bsel" : "#ksel").value = i.id;
    toast(i.nome);
    raiz.querySelector(alvo === "baixa" ? "#bqtd" : "#kqtd").focus();
  };

  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return montar(); }
    const fc = e.target.closest("[data-fechar]");
    if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act, ins = insumos.find((x) => x.id === b.dataset.id);
    b.disabled = true;
    try {
      if (a === "novoI") abrirInsumo(null);
      else if (a === "editI") abrirInsumo(ins);
      else if (a === "lotes") verLotes(ins);
      else if (a === "precos") await verPrecos(ins);
      else if (a === "etq") await verEtiqueta(ins);
      else if (a === "imprimir1") await imprimirEtiquetas([ins]);
      else if (a === "etqs") await imprimirEtiquetas(ativos().sort((x, y) => x.nome.localeCompare(y.nome)));
      else if (a === "additem") { compra.itens.push({ insumoId: "", emb: "1", valor: "", validade: "" }); aCompra(); }
      else if (a === "remitem") { compra.itens.splice(Number(b.dataset.n), 1); aCompra(); }
      else if (a === "lerc") await aplicarCodigo("compra");
      else if (a === "ler") await aplicarCodigo(b.dataset.alvo);
      else if (a === "salvarcompra") await salvarCompra();
      else if (a === "baixar") await baixar();
      else if (a === "contar") await contar();
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });

  raiz.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "fq") { f.q = t.value; aInsumos(); }
    else if (t.id === "mq") { f.mq = t.value; aMov(); }
    else if (t.id === "bq") aBaixa();
    else if (t.id === "cdata") compra.data = t.value;
    else if (t.id === "clocal") compra.local = t.value;
    else if (t.dataset.ci !== undefined) { compra.itens[Number(t.dataset.ci)][t.dataset.k] = t.value; infoItem(Number(t.dataset.ci)); totalCompra(); }
  });

  raiz.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fcat") { f.cat = t.value; aInsumos(); }
    else if (t.id === "fal") { f.alerta = t.checked; aInsumos(); }
    else if (t.id === "mt") { f.mt = t.value; aMov(); }
    else if (t.id === "bsel") { sel.baixa = t.value; aBaixa(); }
    else if (t.id === "ksel") { sel.contagem = t.value; aContagem(); }
    else if (t.id === "cpago") compra.pagoPor = t.value;
    else if (t.id === "clancar") compra.lancar = t.checked;
    else if (t.dataset.ci !== undefined && t.dataset.k === "insumoId") { compra.itens[Number(t.dataset.ci)].insumoId = t.value; infoItem(Number(t.dataset.ci)); }
  });

  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id !== "fI") return;
    const btn = e.target.querySelector(".btn"); btn.disabled = true;
    try { await salvarInsumo(); } catch (err) { erro(err); } finally { btn.disabled = false; }
  });

  // ---------- dados em tempo real ----------
  const paradas = [
    onSnapshot(collection(db, "insumos"), (s) => { insumos = s.docs.map((d) => ({ id: d.id, ...d.data() })); atualizar(); }, erro),
    onSnapshot(query(collection(db, "lotes"), where("qtdAtual", ">", 0)), (s) => { lotes = s.docs.map((d) => ({ id: d.id, ...d.data() })); atualizar(); }, erro)
  ];
  if (admin) paradas.push(onSnapshot(collection(db, "insumos_custos"), (s) => { custos = {}; s.docs.forEach((d) => { custos[d.id] = d.data(); }); if (aba === "insumos") aInsumos(); }, erro));
  if (operacional) paradas.push(onSnapshot(query(collection(db, "movimentacoes"), orderBy("em", "desc"), limit(200)), (s) => { movs = s.docs.map((d) => d.data()); if (aba === "mov") aMov(); }, erro));

  montar();
  return () => paradas.forEach((p) => p());
}
