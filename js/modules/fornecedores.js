import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL } from "../util.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const wa = (t) => {
  const d = String(t || "").replace(/\D/g, "");
  return d ? `https://wa.me/${d.length <= 11 ? "55" + d : d}` : "";
};
const chave = (s) => String(s).trim().toLowerCase();

export async function render(el, { perfil }) {
  let forn = [], orc = [], aba = "forn", editF = null;

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <button class="btn-alt" data-aba="forn">Fornecedores</button>
      <button class="btn-alt" data-aba="orc">Comparar orçamentos</button>
      <span class="flex-1"></span>
      <button id="novo" class="btn"></button>
    </div>
    <div id="corpo"></div>

    <dialog id="dF"><form id="fF" class="space-y-4">
      <h2 class="h2" id="tF"></h2>
      <label>Nome<input name="nome" required maxlength="120" class="input"></label>
      <label>Categoria<input name="categoria" maxlength="60" class="input" placeholder="Ex.: Carnes, Equipamentos, Embalagens"></label>
      <label>Telefone / WhatsApp<input name="telefone" maxlength="30" class="input" placeholder="(88) 99999-0000"></label>
      <label>Observações<textarea name="obs" rows="2" maxlength="500" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dF" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>

    <dialog id="dO"><form id="fO" class="space-y-4">
      <h2 class="h2">Novo orçamento</h2>
      <label>Item orçado<input name="item" required maxlength="120" list="itens" class="input" placeholder="Ex.: Chapa 80 cm a gás"></label>
      <datalist id="itens"></datalist>
      <label>Fornecedor<select name="fornecedorId" class="input"></select></label>
      <label>Valor (R$)<input name="valor" required inputmode="decimal" class="input" placeholder="4.200,00"></label>
      <label>Link da proposta (Google Drive, opcional)<input name="link" class="input" placeholder="https://..."></label>
      <label>Observações<textarea name="obs" rows="2" maxlength="300" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dO" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div>
    </form></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz");
  const dF = raiz.querySelector("#dF"), dO = raiz.querySelector("#dO");
  const fF = raiz.querySelector("#fF"), fO = raiz.querySelector("#fO");

  function desenhar() {
    raiz.querySelectorAll("[data-aba]").forEach((b) => b.classList.toggle("on", b.dataset.aba === aba));
    raiz.querySelector("#novo").textContent = aba === "forn" ? "Novo fornecedor" : "Novo orçamento";
    raiz.querySelector("#corpo").innerHTML = aba === "forn" ? vForn() : vOrc();
  }

  function vForn() {
    if (!forn.length) return `<div class="card">Nenhum fornecedor cadastrado ainda.</div>`;
    const lista = [...forn].sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="card overflow-x-auto"><table>
      <tr><th>Fornecedor</th><th>Categoria</th><th>Contato</th><th></th></tr>
      ${lista.map((f) => `<tr>
        <td><b>${esc(f.nome)}</b>${f.obs ? `<br><small class="text-ink/70">${esc(f.obs)}</small>` : ""}</td>
        <td>${esc(f.categoria)}</td>
        <td>${f.telefone ? `<a class="underline text-brand-dark" href="${wa(f.telefone)}" target="_blank" rel="noopener">${esc(f.telefone)}</a>` : "—"}</td>
        <td class="whitespace-nowrap"><button class="btn-alt" data-act="edf" data-id="${f.id}">Editar</button>
          <button class="btn-alt" data-act="delf" data-id="${f.id}">Excluir</button></td></tr>`).join("")}
    </table></div>`;
  }

  function vOrc() {
    const grupos = new Map();
    orc.forEach((o) => { const k = chave(o.item); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(o); });
    const pend = [...grupos.values()].filter((g) => !g.some((o) => o.escolhido)).length;
    const total = orc.filter((o) => o.escolhido).reduce((s, o) => s + o.valor, 0);
    const kpis = `<div class="grid gap-4 sm:grid-cols-3 mb-4">
      <div class="card"><div class="text-ink/70 text-sm">Itens orçados</div><div class="num">${grupos.size}</div></div>
      <div class="card"><div class="text-ink/70 text-sm">Aguardando escolha</div><div class="num">${pend}</div></div>
      <div class="card"><div class="text-ink/70 text-sm">Total dos escolhidos</div><div class="num">${brl(total)}</div></div></div>`;
    if (!grupos.size) return kpis + `<div class="card">Nenhum orçamento lançado ainda.</div>`;
    return kpis + [...grupos.values()].map((g) => {
      const menor = Math.min(...g.map((o) => o.valor));
      const tem = g.some((o) => o.escolhido);
      return `<div class="card mb-3 overflow-x-auto">
        <div class="flex items-center gap-3 mb-2"><h3 class="h2 flex-1">${esc(g[0].item)}</h3>${tem ? "" : '<span class="tag">Aguardando escolha</span>'}</div>
        <table>${[...g].sort((a, b) => a.valor - b.valor).map((o) => `<tr>
          <td><b>${esc(o.fornecedorNome)}</b>${o.obs ? `<br><small class="text-ink/70">${esc(o.obs)}</small>` : ""}</td>
          <td>${brl(o.valor)} ${o.valor === menor ? '<span class="tag ok">Menor preço</span>' : ""} ${o.escolhido ? '<span class="tag ok">Escolhido</span>' : ""}</td>
          <td>${o.link ? `<a class="underline text-brand-dark" href="${esc(o.link)}" target="_blank" rel="noopener">Proposta</a>` : ""}</td>
          <td class="whitespace-nowrap"><button class="btn-alt" data-act="esc" data-id="${o.id}">${o.escolhido ? "Desfazer" : "Escolher"}</button>
            <button class="btn-alt" data-act="delo" data-id="${o.id}">Excluir</button></td></tr>`).join("")}</table></div>`;
    }).join("");
  }

  function abrirF(f) {
    editF = f || null;
    raiz.querySelector("#tF").textContent = f ? "Editar fornecedor" : "Novo fornecedor";
    const x = fF.elements;
    x.nome.value = f?.nome || ""; x.categoria.value = f?.categoria || "";
    x.telefone.value = f?.telefone || ""; x.obs.value = f?.obs || "";
    dF.showModal();
  }

  function abrirO() {
    if (!forn.length) { toast("Cadastre um fornecedor primeiro."); return; }
    const itens = [...new Set(orc.map((o) => o.item))];
    raiz.querySelector("#itens").innerHTML = itens.map((i) => `<option value="${esc(i)}">`).join("");
    fO.elements.fornecedorId.innerHTML = [...forn].sort((a, b) => a.nome.localeCompare(b.nome))
      .map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join("");
    fO.reset();
    dO.showModal();
  }

  raiz.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-aba]");
    if (a) { aba = a.dataset.aba; return desenhar(); }
    if (e.target.id === "novo") return aba === "forn" ? abrirF(null) : abrirO();
    const fechar = e.target.closest("[data-fechar]");
    if (fechar) return raiz.querySelector("#" + fechar.dataset.fechar).close();
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    try {
      if (b.dataset.act === "edf") abrirF(forn.find((x) => x.id === b.dataset.id));
      else if (b.dataset.act === "delf") {
        const f = forn.find((x) => x.id === b.dataset.id);
        if (confirm(`Excluir o fornecedor "${f.nome}"? Os orçamentos já lançados continuam na lista.`)) {
          await deleteDoc(doc(db, "fornecedores", f.id));
          await auditar(perfil, "fornecedor_excluido", f.nome);
        }
      } else if (b.dataset.act === "delo") {
        const o = orc.find((x) => x.id === b.dataset.id);
        if (confirm(`Excluir o orçamento de ${o.fornecedorNome} para "${o.item}"?`)) {
          await deleteDoc(doc(db, "orcamentos", o.id));
          await auditar(perfil, "orcamento_excluido", `${o.item} / ${o.fornecedorNome}`);
        }
      } else if (b.dataset.act === "esc") {
        const o = orc.find((x) => x.id === b.dataset.id);
        const grupo = orc.filter((x) => chave(x.item) === chave(o.item));
        const lote = writeBatch(db);
        grupo.forEach((x) => lote.update(doc(db, "orcamentos", x.id), { escolhido: o.escolhido ? false : x.id === o.id }));
        await lote.commit();
        await auditar(perfil, o.escolhido ? "orcamento_desmarcado" : "orcamento_escolhido", `${o.item}: ${o.fornecedorNome} ${brl(o.valor)}`);
      }
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  fF.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(fF));
    const dados = { nome: d.nome.trim(), categoria: d.categoria.trim(), telefone: d.telefone.trim(), obs: d.obs.trim(), atualizadoEm: serverTimestamp() };
    try {
      if (editF) {
        const lote = writeBatch(db);
        lote.update(doc(db, "fornecedores", editF.id), dados);
        // mantém o nome atualizado nos orçamentos já lançados
        if (editF.nome !== dados.nome) orc.filter((o) => o.fornecedorId === editF.id)
          .forEach((o) => lote.update(doc(db, "orcamentos", o.id), { fornecedorNome: dados.nome }));
        await lote.commit();
      } else {
        await addDoc(collection(db, "fornecedores"), { ...dados, criadoEm: serverTimestamp() });
        await auditar(perfil, "fornecedor_criado", dados.nome);
      }
      dF.close();
      toast("Fornecedor salvo.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  fO.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(fO));
    const valor = parseBRL(d.valor);
    if (!(valor > 0)) return toast("Informe um valor válido.");
    const link = d.link.trim();
    if (link && !/^https?:\/\//i.test(link)) return toast("O link deve começar com http:// ou https://");
    const f = forn.find((x) => x.id === d.fornecedorId);
    try {
      await addDoc(collection(db, "orcamentos"), {
        item: d.item.trim(), fornecedorId: f.id, fornecedorNome: f.nome, valor, link, obs: d.obs.trim(),
        escolhido: false, criadoPor: perfil.nome, criadoEm: serverTimestamp()
      });
      await auditar(perfil, "orcamento_criado", `${d.item.trim()} / ${f.nome} ${brl(valor)}`);
      dO.close();
      toast("Orçamento salvo.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  const paradas = [
    onSnapshot(collection(db, "fornecedores"), (s) => { forn = s.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); }, (e) => toast(traduzErro(e))),
    onSnapshot(collection(db, "orcamentos"), (s) => { orc = s.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); }, (e) => toast(traduzErro(e)))
  ];
  desenhar();
  return () => paradas.forEach((p) => p());
}
