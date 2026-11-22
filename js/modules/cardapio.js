import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia } from "../util.js";
import { r3, estoqueDe, numero, parseQtd, diasAte, baixarPEPS, ordemPEPS } from "../core/estoque.js";
import { criarCalc, temCiclo, indicadores, arredondar90, fmtQtd, bruto } from "../core/custos.js";
import { produzir, necessidades } from "../core/producao.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const num = (n) => String(n ?? "").replace(".", ",");
const ERROS = {
  ESTOQUE_MUDOU: "O estoque mudou enquanto você registrava. Confira e tente de novo.",
  QTD_INVALIDA: "Informe uma quantidade válida.",
  SEM_ESTOQUE: "Não há estoque suficiente."
};
const erro = (e) => {
  console.error(e);
  toast(e.message === "FALTA_ITEM" ? `Falta ${e.item}: faltam ${fmtQtd(e.falta, e.unidade)} no estoque.` : ERROS[e.message] || traduzErro(e));
};
const SIT = { ok: ["ok", "CMV ok"], atencao: ["", "CMV atenção"], alto: ["bad", "CMV alto"], semPreco: ["", "Sem preço"] };

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  const operacional = admin || perfil.papel === "gerente";
  let receitas = [], insumos = [], lotes = [], custos = {}, precos = {}, cfg = {};
  let aba = "prato", editando = null, ings = [], tipoEdicao = "prato", prodEditado = false;
  const f = { q: "", cat: "" };

  const ABAS = [["prato", "Cardápio"], ["preparo", "Preparos"], ["prod", operacional ? "Produção" : "Preparos prontos"]];
  el.innerHTML = `<div id="raiz">
    <div id="abas" class="flex flex-wrap gap-3 mb-5"></div>
    <div id="corpo"></div>
    <dialog id="dD" style="max-width:46rem"></dialog>
    <dialog id="dX"></dialog>
    <dialog id="dR" style="max-width:46rem"><form id="fR" class="space-y-4">
      <h2 class="h2" id="tR"></h2>
      <label>Nome<input name="nome" required maxlength="120" class="input"></label>
      <div class="grid grid-cols-2 gap-4">
        <label>Categoria<input name="categoria" maxlength="60" list="catsR" class="input" placeholder="Hambúrgueres, Porções, Molhos..."></label><datalist id="catsR"></datalist>
        <label data-so="preparo">Tempo de preparo<input name="tempo" maxlength="40" class="input" placeholder="Ex.: 20 min"></label>
        <label data-so="prato">Tempo de preparo<input name="tempo2" maxlength="40" class="input" placeholder="Ex.: 6 min"></label>
      </div>
      <div data-so="preparo" class="grid grid-cols-3 gap-4">
        <label>Rende<input name="rendimento" inputmode="decimal" class="input" placeholder="1000"></label>
        <label>Unidade<select name="unidade" class="input"><option value="g">g</option><option value="ml">ml</option></select></label>
        <label>Validade (dias)<input name="validadeDias" inputmode="numeric" class="input" placeholder="5"></label>
      </div>
      ${admin ? `<div class="grid grid-cols-2 gap-4" data-so="prato">
        <label>Preço de venda (R$)<input name="precoVenda" inputmode="decimal" class="input" placeholder="26,00"></label>
        <label>Meta de CMV deste item (%)<input name="metaCMV" inputmode="decimal" class="input" placeholder="usa a padrão"></label></div>` : ""}
      <h3 class="h2">Ingredientes e pesagens</h3>
      <div id="ings"></div>
      <button type="button" class="btn-alt" data-act="addIng">+ Adicionar ingrediente</button>
      <h3 class="h2 pt-2">Modo de preparo (POP)</h3>
      <label>Equipamentos<input name="equipamentos" maxlength="160" class="input" placeholder="Chapa, espátula, balança..."></label>
      <label>Passos (um por linha)<textarea name="passos" rows="6" class="input" placeholder="Toste o pão por 30 segundos&#10;Grelhe o blend 3 min de cada lado..."></textarea></label>
      <label>Observações<textarea name="observacoes" rows="2" maxlength="400" class="input"></textarea></label>
      <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="ativo" checked> Ativo (aparece para a equipe)</label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dR" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo");
  const dD = raiz.querySelector("#dD"), dX = raiz.querySelector("#dX"), dR = raiz.querySelector("#dR"), fR = raiz.querySelector("#fR");

  const calc = () => criarCalc({ insumos, receitas, custos });
  const metaDe = (r) => precos[r.id]?.metaCMV ?? cfg.metaCMVporCategoria?.[r.categoria] ?? cfg.metaCMV ?? 30;
  const itemInfo = (k) => { const [tipo, id] = String(k).split(":"); const o = tipo === "insumo" ? insumos.find((i) => i.id === id) : receitas.find((r) => r.id === id); return o ? { tipo, id, nome: o.nome, unidade: o.unidade } : null; };
  const nomeLinha = (l) => itemInfo(`${l.tipo}:${l.id}`)?.nome || l.nome || "(removido)";
  const unLinha = (l) => itemInfo(`${l.tipo}:${l.id}`)?.unidade || l.unidade || "";
  const lista = (tipo) => receitas.filter((r) => r.tipo === tipo).sort((a, b) => a.nome.localeCompare(b.nome));

  // ---------- montagem e atualização ----------
  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    corpo.innerHTML = aba === "prod" ? mProd() : mLista();
    atualizar();
  }
  const atualizar = () => (aba === "prod" ? aProd() : aLista());

  // ===== Listas (cardápio e preparos) =====
  const mLista = () => `<div class="flex flex-wrap items-center gap-3 mb-4">
      <input id="fq" class="input" style="width:14rem;margin:0" placeholder="Buscar..." value="${esc(f.q)}">
      <select id="fcat" class="input" style="width:auto;margin:0"></select><span class="flex-1"></span>
      ${admin ? `<button class="btn-alt" data-act="metas">Metas de CMV</button>` : ""}
      ${operacional ? `<button class="btn" data-act="novo">${aba === "prato" ? "Novo prato" : "Novo preparo"}</button>` : ""}
    </div><div id="kpis" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5"></div><div id="lista" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"></div>`;

  function aLista() {
    const todos = lista(aba), cats = [...new Set(todos.map((r) => r.categoria).filter(Boolean))].sort();
    raiz.querySelector("#fcat").innerHTML = `<option value="">Todas as categorias</option>` + cats.map((c) => `<option ${f.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    raiz.querySelector("#catsR").innerHTML = [...new Set(receitas.map((r) => r.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
    const c = calc(), q = f.q.trim().toLowerCase();
    const vis = todos.filter((r) => (!q || r.nome.toLowerCase().includes(q)) && (!f.cat || r.categoria === f.cat));

    if (admin && aba === "prato") {
      const d = todos.filter((r) => r.ativo !== false).map((r) => ({ r, c: c.custoReceita(r), p: precos[r.id]?.precoVenda }));
      const com = d.filter((x) => x.p > 0 && !x.c.incompleto);
      const cmvMed = com.length ? com.reduce((s, x) => s + (x.c.total / x.p) * 100, 0) / com.length : null;
      const acima = com.filter((x) => (x.c.total / x.p) * 100 > metaDe(x.r)).length;
      const kpi = (r, v, dica = "") => `<div class="card"><div class="text-ink/70 text-sm">${r}</div><div class="num mt-1">${v}</div>${dica ? `<div class="text-xs text-ink/70 mt-1">${dica}</div>` : ""}</div>`;
      raiz.querySelector("#kpis").innerHTML = kpi("Pratos ativos", d.length) + kpi("CMV médio", cmvMed == null ? "—" : cmvMed.toFixed(1) + "%", `meta padrão ${cfg.metaCMV ?? 30}%`) +
        kpi("Acima da meta", acima) + kpi("Custo incompleto", d.filter((x) => x.c.incompleto).length, "falta preço de algum insumo");
    } else raiz.querySelector("#kpis").innerHTML = "";

    raiz.querySelector("#lista").innerHTML = !vis.length
      ? `<div class="card md:col-span-2 xl:col-span-3">${todos.length ? "Nada encontrado." : operacional ? `Nenhum item ainda. Toque em "${aba === "prato" ? "Novo prato" : "Novo preparo"}".` : "Nenhum item cadastrado ainda."}</div>`
      : vis.map((r) => cartao(r, c)).join("");
  }

  function cartao(r, c) {
    let fin = "";
    if (admin) {
      const k = c.custoReceita(r);
      if (r.tipo === "prato") {
        const p = precos[r.id]?.precoVenda, ind = indicadores({ custo: k.total, preco: p, meta: metaDe(r), taxasPct: cfg.taxasPct || 0 });
        const [cls, rot] = SIT[ind.situacao];
        fin = `<div class="flex flex-wrap gap-2 mt-3"><span class="tag">Custo ${brl(k.total)}</span>${p > 0 ? `<span class="tag">Venda ${brl(p)}</span>` : ""}
          <span class="tag ${cls}">${ind.cmv != null ? `CMV ${ind.cmv.toFixed(1)}%` : rot}</span>${ind.margem != null ? `<span class="tag">Margem ${brl(ind.margem)}</span>` : ""}
          ${k.incompleto ? '<span class="tag bad">Custo incompleto</span>' : ""}</div>`;
      } else fin = `<div class="flex flex-wrap gap-2 mt-3"><span class="tag">Custo ${brl(k.total)}</span><span class="tag">${brl(k.total / r.rendimento)}/${r.unidade}</span>${k.incompleto ? '<span class="tag bad">Custo incompleto</span>' : ""}</div>`;
    }
    const pronto = r.tipo === "preparo" ? ` · em estoque ${fmtQtd(estoqueDe(lotes, r.id), r.unidade)}` : "";
    return `<div class="card"><div class="flex items-start gap-2"><h3 class="h2 flex-1">${esc(r.nome)}</h3>${r.ativo === false ? '<span class="tag">Inativo</span>' : ""}</div>
      <p class="text-sm text-ink/70">${esc(r.categoria || "")}${r.pop?.tempo ? ` · ${esc(r.pop.tempo)}` : ""}${r.tipo === "preparo" ? ` · rende ${fmtQtd(r.rendimento, r.unidade)}` : ""}${pronto}</p>${fin}
      <div class="flex flex-wrap gap-3 mt-4"><button class="btn" data-act="cozinha" data-id="${r.id}">Modo cozinha</button><button class="btn-alt" data-act="ver" data-id="${r.id}">Abrir</button></div></div>`;
  }

  // ---------- detalhe ----------
  function detalhe(r) {
    const c = calc(), k = c.custoReceita(r), p = precos[r.id]?.precoVenda, meta = metaDe(r);
    let fin = "";
    if (admin && r.tipo === "prato") {
      const i = indicadores({ custo: k.total, preco: p, meta, taxasPct: cfg.taxasPct || 0 }), [cls, rot] = SIT[i.situacao];
      fin = `<div class="grid grid-cols-2 gap-4 my-4">
        <div class="card"><div class="text-sm text-ink/70">Custo</div><div class="num">${brl(k.total)}</div>${k.incompleto ? '<div class="text-xs mt-1" style="color:#8a1d10">falta preço de algum insumo</div>' : ""}</div>
        <div class="card"><div class="text-sm text-ink/70">Preço de venda</div><div class="num">${p > 0 ? brl(p) : "—"}</div></div>
        <div class="card"><div class="text-sm text-ink/70">CMV (meta ${meta}%)</div><div class="num">${i.cmv != null ? i.cmv.toFixed(1) + "%" : "—"}</div><span class="tag ${cls} mt-1">${rot}</span></div>
        <div class="card"><div class="text-sm text-ink/70">Margem de contribuição</div><div class="num">${i.margem != null ? brl(i.margem) : "—"}</div>${i.margemPct != null ? `<div class="text-xs text-ink/70 mt-1">${i.margemPct.toFixed(0)}% do preço${cfg.taxasPct ? ` · após ${cfg.taxasPct}% de taxas: ${brl(i.margemReal)}` : ""}</div>` : ""}</div></div>
        ${i.sugerido ? `<p class="mb-3">Para a meta de CMV de ${meta}%, o preço sugerido é <b>${brl(i.sugerido)}</b> (arredondado: <b>${brl(arredondar90(i.sugerido))}</b>).</p>` : ""}`;
    } else if (admin) fin = `<p class="my-3">Custo total <b>${brl(k.total)}</b> · <b>${brl(k.total / r.rendimento)}</b> por ${r.unidade}${k.incompleto ? ' <span class="tag bad">custo incompleto</span>' : ""}</p>`;

    const linhas = (r.ingredientes || []).map((l) => {
      const cl = admin ? c.custoLinha(l, r.id) : null;
      return `<tr><td>${esc(nomeLinha(l))}${l.tipo === "preparo" ? ' <span class="tag">preparo</span>' : ""}${l.perda ? `<br><small class="text-ink/70">perda ${l.perda}%: separar ${fmtQtd(bruto(l), unLinha(l))}</small>` : ""}</td>
        <td><b>${fmtQtd(l.qtd, unLinha(l))}</b></td>${admin ? `<td>${cl == null ? '<span class="tag bad">sem preço</span>' : brl(cl)}</td>` : ""}</tr>`;
    }).join("");
    const pop = r.pop || {};
    dD.innerHTML = `<div class="flex items-start gap-3"><h2 class="h2 flex-1">${esc(r.nome)}</h2><button class="btn-alt" data-fechar="dD">Fechar</button></div>
      <p class="text-ink/70 mt-1">${esc(r.categoria || "")}${r.tipo === "preparo" ? ` · rende ${fmtQtd(r.rendimento, r.unidade)}${r.validadeDias ? ` · validade ${r.validadeDias} dias` : ""}` : ""}</p>${fin}
      <h3 class="h2 mt-4 mb-2">Ingredientes</h3>
      <table><tr><th>Ingrediente</th><th>Pesagem</th>${admin ? "<th>Custo</th>" : ""}</tr>${linhas || `<tr><td colspan="${admin ? 3 : 2}">Sem ingredientes.</td></tr>`}</table>
      <h3 class="h2 mt-5 mb-2">Modo de preparo</h3>
      ${pop.tempo || pop.equipamentos ? `<p class="mb-2">${pop.tempo ? `<b>Tempo:</b> ${esc(pop.tempo)} ` : ""}${pop.equipamentos ? `<b>Equipamentos:</b> ${esc(pop.equipamentos)}` : ""}</p>` : ""}
      ${(pop.passos || []).length ? `<ol class="list-decimal pl-6 space-y-2">${pop.passos.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : '<p class="text-ink/70">Sem passo a passo cadastrado.</p>'}
      ${pop.observacoes ? `<p class="mt-3 text-ink/70"><b>Observações:</b> ${esc(pop.observacoes)}</p>` : ""}
      <div class="flex flex-wrap gap-3 mt-6"><button class="btn" data-act="cozinha" data-id="${r.id}">Modo cozinha</button>
        ${operacional ? `<button class="btn-alt" data-act="editar" data-id="${r.id}">Editar</button><button class="btn-alt" data-act="duplicar" data-id="${r.id}">Duplicar</button>` : ""}
        ${admin ? `<button class="btn-alt" data-act="excluir" data-id="${r.id}">Excluir</button>` : ""}</div>`;
    dD.showModal();
  }

  // ---------- editor ----------
  const opcoesItens = (sel, excluir) => `<option value="">Escolha...</option>
    <optgroup label="Insumos">${insumos.filter((i) => i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)).map((i) => `<option value="insumo:${i.id}" ${sel === "insumo:" + i.id ? "selected" : ""}>${esc(i.nome)} (${i.unidade})</option>`).join("")}</optgroup>
    <optgroup label="Preparos">${lista("preparo").filter((r) => r.id !== excluir).map((r) => `<option value="preparo:${r.id}" ${sel === "preparo:" + r.id ? "selected" : ""}>${esc(r.nome)} (${r.unidade})</option>`).join("")}</optgroup>`;

  function desenhaIngs() {
    raiz.querySelector("#ings").innerHTML = ings.map((l, n) => `<div class="card mb-3">
      <label>Ingrediente<select data-ri="${n}" data-k="item" class="input">${opcoesItens(l.item, editando?.id)}</select></label>
      <div class="grid grid-cols-2 gap-4 mt-3">
        <label>Pesagem <span data-un="${n}">${esc(itemInfo(l.item)?.unidade || "")}</span><input data-ri="${n}" data-k="qtd" inputmode="decimal" class="input" value="${esc(l.qtd)}"></label>
        <label>Perda % (opcional)<input data-ri="${n}" data-k="perda" inputmode="decimal" class="input" value="${esc(l.perda)}" placeholder="0"></label></div>
      <button type="button" class="btn-alt mt-3" data-act="remIng" data-n="${n}">Remover</button></div>`).join("") || '<p class="text-ink/70 mb-3">Nenhum ingrediente ainda.</p>';
  }

  function abrirEditor(r, tipo, copia = false) {
    editando = r && !copia ? r : null; tipoEdicao = r ? r.tipo : tipo;
    raiz.querySelector("#tR").textContent = `${editando ? "Editar" : "Novo"} ${tipoEdicao === "prato" ? "prato" : "preparo"}`;
    fR.reset();
    fR.querySelectorAll("[data-so]").forEach((e) => e.classList.toggle("hidden", e.dataset.so !== tipoEdicao));
    const x = fR.elements, pop = r?.pop || {};
    if (r) {
      x.nome.value = copia ? r.nome + " (cópia)" : r.nome; x.categoria.value = r.categoria || ""; x.ativo.checked = r.ativo !== false;
      x.tempo.value = pop.tempo || ""; x.tempo2.value = pop.tempo || ""; x.equipamentos.value = pop.equipamentos || "";
      x.passos.value = (pop.passos || []).join("\n"); x.observacoes.value = pop.observacoes || "";
      if (r.tipo === "preparo") { x.rendimento.value = num(r.rendimento); x.unidade.value = r.unidade; x.validadeDias.value = r.validadeDias || ""; }
      if (admin && r.tipo === "prato" && !copia) { x.precoVenda.value = precos[r.id]?.precoVenda ? num(precos[r.id].precoVenda) : ""; x.metaCMV.value = precos[r.id]?.metaCMV != null ? num(precos[r.id].metaCMV) : ""; }
    }
    ings = (r?.ingredientes || []).map((l) => ({ item: `${l.tipo}:${l.id}`, qtd: num(l.qtd), perda: l.perda ? num(l.perda) : "" }));
    desenhaIngs();
    dD.close(); dR.showModal();
  }

  async function salvar() {
    const d = Object.fromEntries(new FormData(fR)), tipo = tipoEdicao;
    const linhas = [];
    for (const l of ings) {
      const it = itemInfo(l.item), qtd = numero(l.qtd || ""), perda = l.perda ? numero(l.perda) : 0;
      if (!it) return toast("Escolha o ingrediente em todas as linhas.");
      if (!(qtd > 0)) return toast(`Informe a pesagem de "${it.nome}".`);
      if (isNaN(perda) || perda < 0 || perda > 90) return toast(`Perda de "${it.nome}" deve ficar entre 0 e 90%.`);
      linhas.push({ tipo: it.tipo, id: it.id, nome: it.nome, unidade: it.unidade, qtd: r3(qtd), perda });
    }
    if (!linhas.length) return toast("Adicione ao menos um ingrediente.");
    if (temCiclo(receitas, editando?.id || "__novo__", linhas)) return toast("Um preparo não pode usar a si mesmo (nem por outro preparo).");
    let rendimento = 1, unidade = "un", validadeDias = null;
    if (tipo === "preparo") {
      rendimento = numero(d.rendimento || ""); unidade = d.unidade;
      if (!(rendimento > 0)) return toast("Informe quanto o preparo rende.");
      validadeDias = d.validadeDias ? Math.round(numero(d.validadeDias)) : null;
      if (validadeDias !== null && !(validadeDias > 0)) return toast("Validade em dias inválida.");
    }
    const passos = d.passos.split("\n").map((s) => s.trim().replace(/^\d+\s*[.)\-]\s*/, "")).filter(Boolean);
    const dados = {
      nome: d.nome.trim(), tipo, categoria: d.categoria.trim(), unidade, rendimento: r3(rendimento), validadeDias, ingredientes: linhas,
      pop: { passos, equipamentos: d.equipamentos.trim(), tempo: (tipo === "prato" ? d.tempo2 : d.tempo).trim(), observacoes: d.observacoes.trim() },
      ativo: !!d.ativo, atualizadoEm: serverTimestamp()
    };
    let id;
    if (editando) { await updateDoc(doc(db, "receitas", editando.id), dados); id = editando.id; }
    else { id = (await addDoc(collection(db, "receitas"), { ...dados, criadoEm: serverTimestamp() })).id; }
    if (admin && tipo === "prato") {
      const pv = d.precoVenda ? parseBRL(d.precoVenda) : 0, meta = d.metaCMV ? numero(d.metaCMV) : null;
      if (isNaN(pv) || pv < 0 || (meta !== null && (isNaN(meta) || meta <= 0 || meta >= 100))) toast("Preço ou meta inválidos: o restante foi salvo.");
      else await setDoc(doc(db, "receitas_precos", id), { precoVenda: pv, metaCMV: meta, atualizadoEm: serverTimestamp() }, { merge: true });
    }
    await auditar(perfil, editando ? "receita_editada" : "receita_criada", dados.nome);
    dR.close(); toast("Salvo.");
  }

  // ---------- metas de CMV (só sócios) ----------
  function abrirMetas() {
    const cats = [...new Set(lista("prato").map((r) => r.categoria).filter(Boolean))].sort();
    dX.innerHTML = `<form id="fM" class="space-y-4"><h2 class="h2">Metas de CMV e taxas</h2>
      <p class="text-ink/70">CMV é quanto do preço de venda vai para o custo dos ingredientes. A meta define o preço sugerido.</p>
      <div class="grid grid-cols-2 gap-4"><label>Meta padrão (%)<input name="meta" inputmode="decimal" class="input" value="${num(cfg.metaCMV ?? 30)}"></label>
        <label>Taxas e impostos (%)<input name="taxas" inputmode="decimal" class="input" value="${num(cfg.taxasPct ?? 0)}"></label></div>
      <p class="text-xs text-ink/70">As taxas (impostos, taxas de entrega e cartão) entram só no cálculo da margem real, sem alterar o CMV.</p>
      ${cats.length ? `<h3 class="h2">Meta por categoria (opcional)</h3><div class="grid grid-cols-2 gap-4">${cats.map((c) => `<label>${esc(c)} (%)<input data-cat="${esc(c)}" inputmode="decimal" class="input" value="${cfg.metaCMVporCategoria?.[c] != null ? num(cfg.metaCMVporCategoria[c]) : ""}" placeholder="padrão"></label>`).join("")}</div>` : ""}
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dX" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form>`;
    dX.showModal();
  }
  async function salvarMetas(form) {
    const meta = numero(form.elements.meta.value), taxas = numero(form.elements.taxas.value || "0"), porCat = {};
    if (!(meta > 0 && meta < 100) || isNaN(taxas) || taxas < 0 || taxas >= 100) return toast("Confira a meta (entre 0 e 100) e as taxas.");
    for (const i of form.querySelectorAll("[data-cat]")) {
      if (!i.value.trim()) continue;
      const v = numero(i.value); if (!(v > 0 && v < 100)) return toast(`Meta de "${i.dataset.cat}" inválida.`);
      porCat[i.dataset.cat] = v;
    }
    await setDoc(doc(db, "config", "geral"), { metaCMV: meta, taxasPct: taxas, metaCMVporCategoria: porCat }, { mergeFields: ["metaCMV", "taxasPct", "metaCMVporCategoria"] });
    await auditar(perfil, "meta_cmv_alterada", `padrão ${meta}%, taxas ${taxas}%`);
    dX.close(); toast("Metas salvas.");
  }

  async function excluir(r) {
    const usos = receitas.filter((x) => (x.ingredientes || []).some((l) => l.id === r.id));
    if (usos.length) return toast(`Em uso por: ${usos.map((x) => x.nome).join(", ")}. Remova de lá primeiro.`);
    if (!confirm(`Excluir "${r.nome}"? Isso não pode ser desfeito.`)) return;
    await deleteDoc(doc(db, "receitas", r.id));
    try { await deleteDoc(doc(db, "receitas_precos", r.id)); } catch (e) { /* sem preço cadastrado */ }
    await auditar(perfil, "receita_excluida", r.nome);
    dD.close(); toast("Excluído.");
  }

  // ---------- Modo Cozinha (tela cheia, letras grandes) ----------
  async function abrirCozinha(r) {
    let mult = 1, wake = null; const feitos = new Set();
    const ov = document.createElement("div");
    ov.className = "cozinha"; document.body.appendChild(ov); document.body.classList.add("cozinha-aberta");
    try { wake = await navigator.wakeLock?.request("screen"); } catch (e) { /* aparelho sem suporte: segue normal */ }
    try { await ov.requestFullscreen?.(); } catch (e) { /* sem tela cheia nativa: o painel já cobre a tela */ }
    const fechar = () => {
      try { wake?.release(); } catch (e) { /* nada */ }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      ov.remove(); document.body.classList.remove("cozinha-aberta");
    };
    const pop = r.pop || {};
    const des = () => {
      ov.innerHTML = `<div class="cz-topo"><div><h1>${esc(r.nome)}</h1><p>${[pop.tempo, pop.equipamentos].filter(Boolean).map(esc).join(" · ")}</p></div><button class="cz-x" data-cz="fechar">Fechar</button></div>
        <div class="cz-mult"><span>${r.tipo === "prato" ? "Porções" : "Receitas"}:</span>${[0.5, 1, 2, 3, 5].map((m) => `<button data-m="${m}" class="${m === mult ? "on" : ""}">×${m === 0.5 ? "½" : m}</button>`).join("")}</div>
        ${r.tipo === "preparo" ? `<p class="cz-rende">Rende ${fmtQtd(r.rendimento * mult, r.unidade)}</p>` : ""}
        <h2>Pesagens</h2><ul>${(r.ingredientes || []).map((l, i) => `<li data-i="i${i}" class="${feitos.has("i" + i) ? "feito" : ""}"><b>${fmtQtd(l.qtd * mult, unLinha(l))}</b> ${esc(nomeLinha(l))}${l.perda ? `<small>separar ${fmtQtd(bruto(l) * mult, unLinha(l))}</small>` : ""}</li>`).join("")}</ul>
        <h2>Modo de preparo</h2>${(pop.passos || []).length ? `<ol>${pop.passos.map((s, i) => `<li data-i="p${i}" class="${feitos.has("p" + i) ? "feito" : ""}">${esc(s)}</li>`).join("")}</ol>` : "<p>Sem passo a passo cadastrado.</p>"}
        ${pop.observacoes ? `<p class="cz-obs">${esc(pop.observacoes)}</p>` : ""}`;
    };
    ov.addEventListener("click", (e) => {
      if (e.target.closest("[data-cz]")) return fechar();
      const m = e.target.closest("[data-m]"); if (m) { mult = Number(m.dataset.m); return des(); }
      const li = e.target.closest("li[data-i]"); if (li) { const k = li.dataset.i; feitos.has(k) ? feitos.delete(k) : feitos.add(k); li.classList.toggle("feito"); }
    });
    des();
  }

  // ===== Produção e preparos prontos =====
  const mProd = () => `${operacional ? `<div class="card mb-5" style="max-width:40rem"><h3 class="h2 mb-2">Registrar produção</h3>
      <p class="text-ink/70 mb-4">Baixa os ingredientes do estoque (o que vence primeiro sai primeiro) e coloca o preparo pronto no estoque, com validade.</p>
      <label>Preparo<select id="pp" class="input"></select></label>
      <div class="grid grid-cols-2 gap-4 mt-4"><label>Quantas receitas<input id="pv" inputmode="decimal" class="input" value="1"></label>
        <label>Validade<input id="pval" type="date" class="input"></label></div>
      <label class="mt-4">Quanto rendeu de verdade (opcional)<input id="prend" inputmode="decimal" class="input" placeholder="usa o rendimento da receita"></label>
      <div id="ppre" class="mt-4"></div>
      <button class="btn w-full mt-4" data-act="produzir">Registrar produção</button></div>` : ""}
    <div class="card" style="max-width:50rem"><h3 class="h2 mb-2">Preparos prontos em estoque</h3><div id="pest"></div></div>`;

  function aProd() {
    const prep = lista("preparo").filter((r) => r.ativo !== false);
    if (operacional) {
      const s = raiz.querySelector("#pp"), atual = s.value;
      s.innerHTML = `<option value="">Escolha o preparo...</option>` + prep.map((r) => `<option value="${r.id}" ${r.id === atual ? "selected" : ""}>${esc(r.nome)}</option>`).join("");
      preProd();
    }
    raiz.querySelector("#pest").innerHTML = !prep.length ? "<p>Nenhum preparo cadastrado.</p>" : `<table><tr><th>Preparo</th><th>Em estoque</th><th>Validade</th><th></th></tr>
      ${prep.map((r) => {
        const e = estoqueDe(lotes, r.id), v = lotes.filter((l) => l.insumoId === r.id && l.validade).map((l) => l.validade).sort()[0];
        const tv = !v ? "—" : diasAte(v) < 0 ? `<span class="tag bad">Vencido ${fmtDia(v)}</span>` : diasAte(v) <= 2 ? `<span class="tag" style="background:#ffb067">${fmtDia(v)}</span>` : fmtDia(v);
        return `<tr><td><b>${esc(r.nome)}</b></td><td>${fmtQtd(e, r.unidade)}</td><td>${tv}</td><td>${e > 0 ? `<button class="btn-alt" data-act="usar" data-id="${r.id}">Usar / descartar</button>` : ""}</td></tr>`;
      }).join("")}</table>`;
  }

  function preProd() {
    const r = receitas.find((x) => x.id === raiz.querySelector("#pp")?.value), box = raiz.querySelector("#ppre");
    if (!r) { box.innerHTML = ""; return; }
    const vezes = numero(raiz.querySelector("#pv").value || "0");
    if (!prodEditado) {
      raiz.querySelector("#pval").value = r.validadeDias ? new Date(Date.now() + r.validadeDias * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }) : "";
      raiz.querySelector("#prend").placeholder = vezes > 0 ? `${num(r3(r.rendimento * vezes))} ${r.unidade} (da receita)` : "";
    }
    box.innerHTML = vezes > 0 ? `<p class="text-sm text-ink/70 mb-1">Vai consumir:</p>${necessidades(r, vezes).map((n) => {
      const tem = estoqueDe(lotes, n.id), faltou = tem < n.qtd, un = itemInfo(`${n.tipo}:${n.id}`)?.unidade || n.unidade;
      return `<p class="py-1">${faltou ? "⚠" : "✔"} <b>${esc(itemInfo(`${n.tipo}:${n.id}`)?.nome || n.nome)}</b> ${fmtQtd(n.qtd, un)} <small class="text-ink/70">(há ${fmtQtd(tem, un)})</small>${faltou ? ' <span class="tag bad">falta</span>' : ""}</p>`;
    }).join("")}` : "";
  }

  async function registrarProducao() {
    const r = receitas.find((x) => x.id === raiz.querySelector("#pp").value);
    if (!r) return toast("Escolha o preparo.");
    const vezes = numero(raiz.querySelector("#pv").value || "0");
    if (!(vezes > 0)) return toast("Informe quantas receitas.");
    const real = raiz.querySelector("#prend").value.trim() ? numero(raiz.querySelector("#prend").value) : r.rendimento * vezes;
    if (!(real > 0)) return toast("Rendimento inválido.");
    await produzir({ receita: r, vezes, rendimentoReal: real, validade: raiz.querySelector("#pval").value, lotes, perfil, nomeDe: (n) => itemInfo(`${n.tipo}:${n.id}`)?.nome });
    await auditar(perfil, "producao_registrada", `${r.nome}: ${fmtQtd(real, r.unidade)} (×${vezes})`);
    toast(`Produção registrada: ${fmtQtd(real, r.unidade)} de ${r.nome}.`);
    raiz.querySelector("#pv").value = "1"; raiz.querySelector("#prend").value = ""; prodEditado = false; aProd();
  }

  function abrirUsar(r) {
    dX.innerHTML = `<form id="fU" class="space-y-4" data-id="${r.id}"><h2 class="h2">${esc(r.nome)}</h2>
      <p>Em estoque: <b>${fmtQtd(estoqueDe(lotes, r.id), r.unidade)}</b></p>
      <label>Quantidade (${r.unidade})<input name="qtd" class="input qtd-grande" inputmode="decimal" placeholder="Ex.: 500 ou 1,5 kg" autocomplete="off"></label>
      <label>Motivo<select name="mot" class="input"><option value="baixa">Uso na cozinha</option><option value="descarte">Descarte / vencido</option></select></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dX" class="btn-alt">Cancelar</button><button class="btn">Registrar</button></div></form>`;
    dX.showModal();
  }
  async function salvarUsar(form) {
    const r = receitas.find((x) => x.id === form.dataset.id), q = parseQtd(form.elements.qtd.value, r.unidade);
    if (q.erro) return toast(q.erro);
    const tipo = form.elements.mot.value;
    await baixarPEPS({ insumo: { id: r.id, nome: r.nome, unidade: r.unidade }, qtd: q.valor, tipo, motivo: tipo === "descarte" ? "descarte" : "uso", obs: "Preparo", perfil, lotes });
    dX.close(); toast(`Saída registrada: ${fmtQtd(q.valor, r.unidade)} de ${r.nome}.`);
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return montar(); }
    const fc = e.target.closest("[data-fechar]");
    if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act, r = receitas.find((x) => x.id === b.dataset.id);
    b.disabled = true;
    try {
      if (a === "ver") detalhe(r);
      else if (a === "cozinha") await abrirCozinha(r);
      else if (a === "novo") abrirEditor(null, aba);
      else if (a === "editar") abrirEditor(r);
      else if (a === "duplicar") abrirEditor(r, r.tipo, true);
      else if (a === "excluir") await excluir(r);
      else if (a === "metas") abrirMetas();
      else if (a === "addIng") { ings.push({ item: "", qtd: "", perda: "" }); desenhaIngs(); }
      else if (a === "remIng") { ings.splice(Number(b.dataset.n), 1); desenhaIngs(); }
      else if (a === "produzir") await registrarProducao();
      else if (a === "usar") abrirUsar(r);
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });

  raiz.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "fq") { f.q = t.value; aLista(); }
    else if (t.id === "pv") preProd();
    else if (t.id === "pval" || t.id === "prend") prodEditado = true;
    else if (t.dataset.ri !== undefined && t.dataset.k !== "item") ings[Number(t.dataset.ri)][t.dataset.k] = t.value;
  });
  raiz.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fcat") { f.cat = t.value; aLista(); }
    else if (t.id === "pp") { prodEditado = false; preProd(); }
    else if (t.dataset.ri !== undefined && t.dataset.k === "item") {
      ings[Number(t.dataset.ri)].item = t.value;
      const u = raiz.querySelector(`[data-un="${t.dataset.ri}"]`); if (u) u.textContent = itemInfo(t.value)?.unidade || "";
    }
  });
  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn"); btn.disabled = true;
    try {
      if (e.target.id === "fR") await salvar();
      else if (e.target.id === "fM") await salvarMetas(e.target);
      else if (e.target.id === "fU") await salvarUsar(e.target);
    } catch (err) { erro(err); } finally { btn.disabled = false; }
  });

  // ---------- dados em tempo real (o custo se recalcula sozinho quando um preço muda) ----------
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const paradas = [
    onSnapshot(collection(db, "receitas"), (s) => { receitas = ver(s); atualizar(); }, erro),
    onSnapshot(collection(db, "insumos"), (s) => { insumos = ver(s); atualizar(); }, erro),
    onSnapshot(query(collection(db, "lotes"), where("qtdAtual", ">", 0)), (s) => { lotes = ver(s); atualizar(); }, erro),
    onSnapshot(doc(db, "config", "geral"), (s) => { cfg = s.exists() ? s.data() : {}; atualizar(); }, erro)
  ];
  if (admin) {
    paradas.push(onSnapshot(collection(db, "insumos_custos"), (s) => { custos = {}; s.docs.forEach((d) => { custos[d.id] = d.data(); }); atualizar(); }, erro));
    paradas.push(onSnapshot(collection(db, "receitas_precos"), (s) => { precos = {}; s.docs.forEach((d) => { precos[d.id] = d.data(); }); atualizar(); }, erro));
  }
  montar();
  return () => paradas.forEach((p) => p());
}
