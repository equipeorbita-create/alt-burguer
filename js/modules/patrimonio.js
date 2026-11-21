import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia } from "../util.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ESTADOS = { bom: "Bom", regular: "Regular", ruim: "Ruim" };
const SITUACOES = { em_uso: "Em uso", guardado: "Guardado", manutencao: "Em manutenção", baixado: "Baixado" };
const ORIGENS = { imovel: "Já existia no imóvel", comprado: "Comprado", doado: "Doado / emprestado", outro: "Outro" };
const opcoes = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

const tagEstado = (e) => e === "bom" ? `<span class="tag ok">Bom</span>`
  : e === "ruim" ? `<span class="tag bad">Ruim</span>`
  : `<span class="tag" style="background:#ffb067;color:#1c1c1c">Regular</span>`;

// Miniatura de foto do Google Drive (funciona se o arquivo estiver compartilhado "com o link")
const idDrive = (u) => (String(u).match(/\/d\/([\w-]{10,})/) || String(u).match(/[?&]id=([\w-]{10,})/) || [])[1];
const miniatura = (u) => { const id = idDrive(u); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w400` : null; };
const csvCel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const num = (n) => (n == null ? "" : String(n).replace(".", ","));

export async function render(el, { perfil }) {
  let bens = [], aberto = null, editando = null;
  const f = { q: "", estado: "", situacao: "", local: "" };

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input id="busca" class="input" style="width:12rem;margin:0" placeholder="Buscar bem...">
      <select id="fest" class="input" style="width:auto;margin:0"><option value="">Todos os estados</option>${opcoes(ESTADOS)}</select>
      <select id="fsit" class="input" style="width:auto;margin:0"><option value="">Todas as situações</option>${opcoes(SITUACOES)}</select>
      <select id="floc" class="input" style="width:auto;margin:0"></select>
      <span class="flex-1"></span>
      <button id="csv" class="btn-alt">Exportar CSV</button>
      <button id="novo" class="btn">Novo bem</button>
    </div>
    <div id="kpis" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4"></div>
    <div id="lista"></div>

    <dialog id="dF"><form id="fF" class="space-y-4">
      <h2 class="h2" id="tF"></h2>
      <label>Nome do bem<input name="nome" required maxlength="120" class="input" placeholder="Ex.: Geladeira vertical 2 portas"></label>
      <div class="grid grid-cols-2 gap-4">
        <label>Marca / modelo<input name="marca" maxlength="120" class="input"></label>
        <label>Quantidade<input name="quantidade" type="number" min="1" value="1" required class="input"></label>
        <label>Estado de conservação<select name="estado" class="input">${opcoes(ESTADOS, "bom")}</select></label>
        <label>Situação<select name="situacao" class="input">${opcoes(SITUACOES, "em_uso")}</select></label>
        <label>Localização<input name="localizacao" maxlength="80" class="input" placeholder="Cozinha, salão..."></label>
        <label>Origem<select name="origem" class="input">${opcoes(ORIGENS, "imovel")}</select></label>
      </div>
      <p class="text-xs text-ink/70">Os valores abaixo são <b>por unidade</b>.</p>
      <div class="grid grid-cols-2 gap-4">
        <label>Valor de mercado (R$)<input name="valorMercado" inputmode="decimal" class="input" placeholder="2.800,00"></label>
        <label>Valor de aquisição (R$), se souber<input name="valorAquisicao" inputmode="decimal" class="input"></label>
        <label>Valor atribuído ao inventário (R$)<input name="valorAtribuido" inputmode="decimal" class="input" placeholder="2.000,00"></label>
        <label>Data de aquisição<input name="dataAquisicao" type="date" class="input"></label>
      </div>
      <label>Fotos (links do Google Drive, um por linha, até 10)<textarea name="fotos" rows="3" class="input" placeholder="https://drive.google.com/file/d/..."></textarea></label>
      <label>Observações<textarea name="observacoes" rows="2" maxlength="500" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dF" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>

    <dialog id="dD" style="max-width:44rem"></dialog>

    <dialog id="dM"><form id="fM" class="space-y-4">
      <h2 class="h2">Registrar manutenção</h2>
      <label>O que foi feito<input name="texto" required maxlength="200" class="input"></label>
      <div class="grid grid-cols-2 gap-4">
        <label>Custo (R$), opcional<input name="custo" inputmode="decimal" class="input"></label>
        <label>Data<input name="data" type="date" class="input"></label>
      </div>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dM" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz");
  const dF = raiz.querySelector("#dF"), dD = raiz.querySelector("#dD"), dM = raiz.querySelector("#dM");
  const fF = raiz.querySelector("#fF"), fM = raiz.querySelector("#fM");

  const filtrados = () => {
    const q = f.q.trim().toLowerCase();
    return bens
      .filter((b) => (!q || `${b.nome} ${b.marca} ${b.localizacao}`.toLowerCase().includes(q))
        && (!f.estado || b.estado === f.estado) && (!f.situacao || b.situacao === f.situacao)
        && (!f.local || b.localizacao === f.local))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  };

  function desenhar() {
    const locais = [...new Set(bens.map((b) => b.localizacao).filter(Boolean))].sort();
    const sel = raiz.querySelector("#floc");
    sel.innerHTML = `<option value="">Todos os locais</option>` + locais.map((l) => `<option ${f.local === l ? "selected" : ""}>${esc(l)}</option>`).join("");

    const lista = filtrados();
    const itens = lista.reduce((s, b) => s + b.quantidade, 0);
    const merc = lista.reduce((s, b) => s + b.valorMercado * b.quantidade, 0);
    const atrib = lista.reduce((s, b) => s + b.valorAtribuido * b.quantidade, 0);
    const ruins = lista.filter((b) => b.estado === "ruim").length;
    const kpi = (r, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${r}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
    raiz.querySelector("#kpis").innerHTML =
      kpi("Bens cadastrados", lista.length, `${itens} unidades`) + kpi("Valor de mercado", brl(merc)) +
      kpi("Valor atribuído ao inventário", brl(atrib)) + kpi("Em estado ruim", ruins);

    raiz.querySelector("#lista").innerHTML = !lista.length
      ? `<div class="card">${bens.length ? "Nenhum bem encontrado com esse filtro." : "Nenhum bem cadastrado ainda. Clique em \"Novo bem\" para começar o inventário."}</div>`
      : `<div class="card overflow-x-auto"><table>
        <tr><th>Bem</th><th>Qtd.</th><th>Estado</th><th>Situação</th><th>Local</th><th>Mercado</th><th>Atribuído</th><th>Fotos</th><th></th></tr>
        ${lista.map((b) => `<tr>
          <td><b>${esc(b.nome)}</b>${b.marca ? `<br><small class="text-ink/70">${esc(b.marca)}</small>` : ""}</td>
          <td>${b.quantidade}</td><td>${tagEstado(b.estado)}</td>
          <td>${esc(SITUACOES[b.situacao] || b.situacao)}</td><td>${esc(b.localizacao) || "—"}</td>
          <td>${brl(b.valorMercado * b.quantidade)}</td><td>${brl(b.valorAtribuido * b.quantidade)}</td>
          <td>${(b.fotos || []).length}</td>
          <td><button class="btn-alt" data-act="ver" data-id="${b.id}">Abrir</button></td></tr>`).join("")}
      </table></div>`;
  }

  function detalhe() {
    const b = bens.find((x) => x.id === aberto);
    if (!b) { if (dD.open) dD.close(); return; }
    const fotos = (b.fotos || []).map((u, i) => {
      const m = miniatura(u);
      return `<a href="${esc(u)}" target="_blank" rel="noopener" class="block">${m
        ? `<img src="${esc(m)}" alt="Foto ${i + 1} de ${esc(b.nome)}" referrerpolicy="no-referrer" class="rounded-lg w-full h-28 object-cover bg-ink/5">`
        : `<span class="underline text-brand-dark text-sm">Abrir foto ${i + 1}</span>`}</a>`;
    }).join("");
    const hist = [...(b.historico || [])].reverse();
    dD.innerHTML = `
      <div class="flex items-start gap-3 mb-2"><h2 class="h2 flex-1">${esc(b.nome)}</h2><button class="btn-alt" data-fechar="dD">Fechar</button></div>
      <div class="flex flex-wrap gap-3 mb-3">${tagEstado(b.estado)}<span class="tag">${esc(SITUACOES[b.situacao] || b.situacao)}</span><span class="tag">${esc(ORIGENS[b.origem] || "")}</span></div>
      <table>
        <tr><th>Marca / modelo</th><td>${esc(b.marca) || "—"}</td></tr>
        <tr><th>Quantidade</th><td>${b.quantidade}</td></tr>
        <tr><th>Localização</th><td>${esc(b.localizacao) || "—"}</td></tr>
        <tr><th>Valor de mercado (un.)</th><td>${brl(b.valorMercado)}</td></tr>
        <tr><th>Valor de aquisição (un.)</th><td>${b.valorAquisicao != null ? brl(b.valorAquisicao) : "não informado"}</td></tr>
        <tr><th>Valor atribuído (un.)</th><td>${brl(b.valorAtribuido)}</td></tr>
        <tr><th>Data de aquisição</th><td>${b.dataAquisicao ? fmtDia(b.dataAquisicao) : "—"}</td></tr>
        <tr><th>Levantado por</th><td>${esc(b.levantadoPor)}</td></tr>
        ${b.observacoes ? `<tr><th>Observações</th><td>${esc(b.observacoes)}</td></tr>` : ""}
      </table>
      ${fotos ? `<h3 class="h2 mt-4 mb-2">Fotos</h3><div class="grid grid-cols-3 gap-3">${fotos}</div>` : ""}
      <h3 class="h2 mt-4 mb-2">Histórico</h3>
      <ul class="space-y-1 text-sm">${hist.map((h) => `<li><span class="tag">${fmtDia(h.em)}</span> ${esc(h.texto)}${h.custo != null ? ` · ${brl(h.custo)}` : ""} <span class="text-ink/70">· ${esc(h.por)}</span></li>`).join("") || "<li>Sem registros.</li>"}</ul>
      <div class="flex flex-wrap gap-3 mt-4">
        <button class="btn" data-act="man" data-id="${b.id}">Registrar manutenção</button>
        <button class="btn-alt" data-act="ed" data-id="${b.id}">Editar</button>
        <button class="btn-alt" data-act="del" data-id="${b.id}">Excluir</button>
      </div>`;
  }

  function abrirForm(b) {
    editando = b || null;
    raiz.querySelector("#tF").textContent = b ? "Editar bem" : "Novo bem do inventário";
    fF.reset();
    const x = fF.elements;
    if (b) {
      x.nome.value = b.nome; x.marca.value = b.marca || ""; x.quantidade.value = b.quantidade;
      x.estado.value = b.estado; x.situacao.value = b.situacao; x.localizacao.value = b.localizacao || "";
      x.origem.value = b.origem || "imovel"; x.valorMercado.value = num(b.valorMercado);
      x.valorAquisicao.value = num(b.valorAquisicao); x.valorAtribuido.value = num(b.valorAtribuido);
      x.dataAquisicao.value = b.dataAquisicao || ""; x.fotos.value = (b.fotos || []).join("\n");
      x.observacoes.value = b.observacoes || "";
    }
    dF.showModal();
  }

  raiz.addEventListener("click", async (e) => {
    if (e.target.id === "novo") return abrirForm(null);
    if (e.target.id === "csv") return exportarCSV();
    const fechar = e.target.closest("[data-fechar]");
    if (fechar) { const d = raiz.querySelector("#" + fechar.dataset.fechar); if (d.id === "dD") aberto = null; return d.close(); }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const bem = bens.find((x) => x.id === b.dataset.id);
    if (!bem) return;
    try {
      if (b.dataset.act === "ver") { aberto = bem.id; detalhe(); dD.showModal(); }
      else if (b.dataset.act === "ed") { dD.close(); aberto = null; abrirForm(bem); }
      else if (b.dataset.act === "man") { fM.reset(); fM.elements.data.value = hojeISO(); fM.dataset.id = bem.id; dM.showModal(); }
      else if (b.dataset.act === "del" && confirm(`Excluir "${bem.nome}" do inventário? Isso não pode ser desfeito.`)) {
        await deleteDoc(doc(db, "patrimonio", bem.id));
        await auditar(perfil, "bem_excluido", bem.nome);
        dD.close(); aberto = null; toast("Bem excluído.");
      }
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  raiz.addEventListener("input", (e) => { if (e.target.id === "busca") { f.q = e.target.value; desenhar(); } });
  raiz.addEventListener("change", (e) => {
    const k = { fest: "estado", fsit: "situacao", floc: "local" }[e.target.id];
    if (k) { f[k] = e.target.value; desenhar(); }
  });
  // foto que o Drive não deixa mostrar vira link simples
  raiz.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG") {
      const s = document.createElement("span");
      s.className = "underline text-brand-dark text-sm"; s.textContent = "Abrir foto";
      e.target.replaceWith(s);
    }
  }, true);

  fF.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(fF));
    const quantidade = Math.round(Number(d.quantidade));
    const vm = parseBRL(d.valorMercado || "0"), va = parseBRL(d.valorAtribuido || "0");
    const vq = d.valorAquisicao.trim() ? parseBRL(d.valorAquisicao) : null;
    if (!(quantidade >= 1) || [vm, va].some(isNaN) || (vq !== null && isNaN(vq))) return toast("Confira a quantidade e os valores.");
    const fotos = d.fotos.split("\n").map((s) => s.trim()).filter(Boolean);
    if (fotos.length > 10) return toast("No máximo 10 fotos por bem.");
    if (fotos.some((u) => !/^https?:\/\//i.test(u))) return toast("Os links das fotos devem começar com http:// ou https://");

    const dados = {
      nome: d.nome.trim(), marca: d.marca.trim(), quantidade, estado: d.estado, situacao: d.situacao,
      localizacao: d.localizacao.trim(), origem: d.origem, valorMercado: vm, valorAquisicao: vq, valorAtribuido: va,
      dataAquisicao: d.dataAquisicao || "", fotos, observacoes: d.observacoes.trim(), atualizadoEm: serverTimestamp()
    };
    const evento = (texto) => ({ em: hojeISO(), tipo: "alteracao", texto, por: perfil.nome });
    try {
      if (editando) {
        const hist = [...(editando.historico || [])];
        if (editando.localizacao !== dados.localizacao) hist.push(evento(`Local: ${editando.localizacao || "—"} → ${dados.localizacao || "—"}`));
        if (editando.situacao !== dados.situacao) hist.push(evento(`Situação: ${SITUACOES[editando.situacao]} → ${SITUACOES[dados.situacao]}`));
        await updateDoc(doc(db, "patrimonio", editando.id), { ...dados, historico: hist });
        await auditar(perfil, "bem_editado", dados.nome);
      } else {
        await addDoc(collection(db, "patrimonio"), {
          ...dados, historico: [evento("Bem cadastrado no inventário")],
          levantadoPor: perfil.nome, criadoEm: serverTimestamp()
        });
        await auditar(perfil, "bem_cadastrado", dados.nome);
      }
      dF.close();
      toast("Bem salvo.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  fM.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(fM));
    const bem = bens.find((x) => x.id === fM.dataset.id);
    const custo = d.custo.trim() ? parseBRL(d.custo) : null;
    if (custo !== null && isNaN(custo)) return toast("Custo inválido.");
    try {
      const hist = [...(bem.historico || []), { em: d.data || hojeISO(), tipo: "manutencao", texto: `Manutenção: ${d.texto.trim()}`, custo, por: perfil.nome }];
      await updateDoc(doc(db, "patrimonio", bem.id), { historico: hist, atualizadoEm: serverTimestamp() });
      await auditar(perfil, "bem_manutencao", `${bem.nome}: ${d.texto.trim()}`);
      dM.close();
      toast("Manutenção registrada.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  function exportarCSV() {
    const cab = ["Bem", "Marca/modelo", "Qtd", "Estado", "Situação", "Local", "Origem", "Valor mercado (un.)", "Valor aquisição (un.)", "Valor atribuído (un.)", "Data aquisição", "Levantado por", "Observações", "Fotos"];
    const linhas = filtrados().map((b) => [b.nome, b.marca, b.quantidade, ESTADOS[b.estado], SITUACOES[b.situacao], b.localizacao,
      ORIGENS[b.origem], num(b.valorMercado), num(b.valorAquisicao), num(b.valorAtribuido), b.dataAquisicao, b.levantadoPor,
      b.observacoes, (b.fotos || []).join(" | ")].map(csvCel).join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + [cab.map(csvCel).join(";"), ...linhas].join("\r\n")], { type: "text/csv" }));
    a.download = "inventario-alt-burguer.csv";
    a.click();
  }

  const parar = onSnapshot(collection(db, "patrimonio"),
    (snap) => { bens = snap.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); if (aberto) detalhe(); },
    (err) => { console.error(err); toast(traduzErro(err)); });

  desenhar();
  return parar;
}
