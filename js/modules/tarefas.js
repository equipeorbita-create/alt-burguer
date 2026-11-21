import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, hojeISO, fmtDia } from "../util.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLS = [["a_fazer", "A fazer"], ["andamento", "Em andamento"], ["concluido", "Concluído"]];
const RESP = ["Davi", "Eliabe", "Ambos", "Gerente"];

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin";
  let tarefas = [], tipo = "todas", resp = "todos", editando = null;

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <div id="abas" class="flex gap-3 flex-wrap"></div>
      <select id="fresp" class="input" style="width:auto;margin:0">
        <option value="todos">Todos os responsáveis</option>${RESP.map((r) => `<option>${r}</option>`).join("")}
      </select>
      <span class="flex-1"></span>
      <button id="nova" class="btn">Nova tarefa</button>
    </div>
    <div id="quadro" class="kanban"></div>
    <dialog id="dlg">
      <form id="form" class="space-y-4">
        <h2 class="h2" id="tit"></h2>
        <label>Título<input name="titulo" required maxlength="200" class="input"></label>
        <label>Descrição<textarea name="descricao" rows="2" maxlength="500" class="input"></textarea></label>
        <div class="grid grid-cols-2 gap-4">
          <label>Responsável<select name="responsavel" class="input">${RESP.map((r) => `<option>${r}</option>`).join("")}</select></label>
          <label>Prazo<input name="prazo" type="date" class="input"></label>
        </div>
        <label>Tipo<select name="tipo" class="input">
          <option value="tarefa">Implantação / rotina</option>
          <option value="melhoria">Ponto a melhorar</option></select></label>
        <label>Etapas do checklist (uma por linha)<textarea name="etapas" rows="4" class="input"></textarea></label>
        <div class="flex gap-3 justify-end">
          <button type="button" id="cancelar" class="btn-alt">Cancelar</button>
          <button class="btn">Salvar</button>
        </div>
      </form>
    </dialog></div>`;

  const raiz = el.querySelector("#raiz");
  const dlg = raiz.querySelector("#dlg");
  const form = raiz.querySelector("#form");

  function cartao(t, ci, hoje) {
    const ck = t.checklist || [];
    const feitos = ck.filter((c) => c.feito).length;
    const atras = t.prazo && t.prazo < hoje && t.status !== "concluido";
    return `<article class="card mb-3">
      <p class="font-semibold">${esc(t.titulo)}</p>
      ${t.descricao ? `<p class="text-sm text-ink/70 mt-1">${esc(t.descricao)}</p>` : ""}
      <div class="flex flex-wrap gap-1 mt-2">
        <span class="tag">${esc(t.responsavel)}</span>
        ${t.tipo === "melhoria" ? '<span class="tag" style="background:#ffb067;color:#1c1c1c">Melhoria</span>' : ""}
        ${t.prazo ? `<span class="tag ${atras ? "bad" : ""}">${atras ? "Atrasada · " : "até "}${fmtDia(t.prazo)}</span>` : ""}
      </div>
      ${ck.length ? `<div class="mt-2 text-sm text-ink/70">${feitos}/${ck.length} etapas</div>
        ${ck.map((c, i) => `<label class="flex gap-3 items-start text-sm" style="color:inherit"><input type="checkbox" class="mt-1" data-act="ck" data-id="${t.id}" data-i="${i}" ${c.feito ? "checked" : ""}><span>${esc(c.texto)}</span></label>`).join("")}` : ""}
      <div class="flex flex-wrap gap-3 mt-3">
        ${ci > 0 ? `<button class="btn-alt" data-act="mv" data-d="-1" data-id="${t.id}">Voltar</button>` : ""}
        ${ci < 2 ? `<button class="btn-alt" data-act="mv" data-d="1" data-id="${t.id}">Avançar</button>` : ""}
        <button class="btn-alt" data-act="ed" data-id="${t.id}">Editar</button>
        ${admin ? `<button class="btn-alt" data-act="del" data-id="${t.id}">Excluir</button>` : ""}
      </div></article>`;
  }

  function desenhar() {
    raiz.querySelector("#abas").innerHTML = [["todas", "Todas"], ["tarefa", "Implantação"], ["melhoria", "Pontos a melhorar"]]
      .map(([k, l]) => `<button class="btn-alt ${tipo === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    const hoje = hojeISO();
    const vis = tarefas
      .filter((t) => (tipo === "todas" || t.tipo === tipo) && (resp === "todos" || t.responsavel === resp))
      .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
    raiz.querySelector("#quadro").innerHTML = COLS.map(([k, nome], ci) => {
      const col = vis.filter((t) => t.status === k);
      return `<section>
        <h3 class="font-bold mb-2">${nome} <span class="text-ink/70 text-sm">${col.length}</span></h3>
        ${col.map((t) => cartao(t, ci, hoje)).join("") || '<p class="text-ink/70 text-sm">Nada aqui.</p>'}
      </section>`;
    }).join("");
  }

  function abrir(t) {
    editando = t || null;
    raiz.querySelector("#tit").textContent = t ? "Editar tarefa" : "Nova tarefa";
    const f = form.elements;
    f.titulo.value = t?.titulo || "";
    f.descricao.value = t?.descricao || "";
    f.responsavel.value = t?.responsavel || "Davi";
    f.prazo.value = t?.prazo || "";
    f.tipo.value = t?.tipo || "tarefa";
    f.etapas.value = (t?.checklist || []).map((c) => c.texto).join("\n");
    dlg.showModal();
  }

  raiz.addEventListener("click", async (e) => {
    const aba = e.target.closest("[data-aba]");
    if (aba) { tipo = aba.dataset.aba; return desenhar(); }
    if (e.target.id === "nova") return abrir(null);
    if (e.target.id === "cancelar") return dlg.close();
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const t = tarefas.find((x) => x.id === b.dataset.id);
    if (!t) return;
    try {
      if (b.dataset.act === "mv") {
        const i = COLS.findIndex((c) => c[0] === t.status) + Number(b.dataset.d);
        if (i < 0 || i > 2) return;
        await updateDoc(doc(db, "tarefas", t.id), { status: COLS[i][0], atualizadoEm: serverTimestamp() });
        if (COLS[i][0] === "concluido") await auditar(perfil, "tarefa_concluida", t.titulo);
      } else if (b.dataset.act === "ed") {
        abrir(t);
      } else if (b.dataset.act === "del" && confirm(`Excluir a tarefa "${t.titulo}"?`)) {
        await deleteDoc(doc(db, "tarefas", t.id));
        await auditar(perfil, "tarefa_excluida", t.titulo);
      }
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  raiz.addEventListener("change", async (e) => {
    if (e.target.id === "fresp") { resp = e.target.value; return desenhar(); }
    const c = e.target.closest('input[data-act="ck"]');
    if (!c) return;
    const t = tarefas.find((x) => x.id === c.dataset.id);
    const checklist = t.checklist.map((x, i) => (i === Number(c.dataset.i) ? { ...x, feito: c.checked } : x));
    try { await updateDoc(doc(db, "tarefas", t.id), { checklist, atualizadoEm: serverTimestamp() }); }
    catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const antigas = editando?.checklist || [];
    const checklist = d.etapas.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50)
      .map((texto) => ({ texto, feito: antigas.some((c) => c.texto === texto && c.feito) }));
    const dados = {
      titulo: d.titulo.trim(), descricao: d.descricao.trim(), responsavel: d.responsavel,
      tipo: d.tipo, prazo: d.prazo || "", checklist, atualizadoEm: serverTimestamp()
    };
    try {
      if (editando) {
        await updateDoc(doc(db, "tarefas", editando.id), dados);
      } else {
        await addDoc(collection(db, "tarefas"), { ...dados, status: "a_fazer", criadoPor: perfil.nome, criadoEm: serverTimestamp() });
        await auditar(perfil, "tarefa_criada", dados.titulo);
      }
      dlg.close();
      toast("Tarefa salva.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  // Atualização em tempo real: o que um sócio muda aparece para o outro na hora.
  const parar = onSnapshot(collection(db, "tarefas"),
    (snap) => { tarefas = snap.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); },
    (err) => { console.error(err); toast(traduzErro(err)); });

  desenhar();
  return parar; // o roteador chama isto ao sair da página
}
