import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, hojeISO, fmtDia } from "../util.js";
import { carregarUsuariosAtivos } from "../core/equipe.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLS = [["a_fazer", "A fazer"], ["andamento", "Em andamento"], ["concluido", "Concluído"]];
const PAPEL = { admin: "Sócio", gerente: "Gerente", funcionario: "Funcionário" };
const pendentes = (t) => (t.checklist || []).filter((c) => !c.feito).length;
const erro = (e) => { console.error(e); toast(traduzErro(e)); };

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin", uid = perfil.uid;
  const pessoas = admin ? await carregarUsuariosAtivos() : [];
  const socios = pessoas.filter((p) => p.papel === "admin");
  let tarefas = [], tipo = "todas", quem = "todos", editando = null, migrou = false;

  // cada sócio tem uma cor: o primeiro laranja, o segundo charcoal
  const estiloPessoa = (id) => {
    const i = socios.findIndex((s) => s.uid === id);
    return i === 0 ? "background:#EA681D;color:#272928" : i === 1 ? "background:#272928;color:#F4F1E6" : "";
  };

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <div id="abas" class="flex gap-3 flex-wrap"></div>
      ${admin ? `<select id="fquem" class="input" style="width:auto;margin:0"><option value="todos">Todas as pessoas</option><option value="minhas">Minhas tarefas</option>
        ${pessoas.map((p) => `<option value="${p.uid}">${esc(p.nome)}</option>`).join("")}</select>` : ""}
      <span class="flex-1"></span>${admin ? '<button id="nova" class="btn">Nova tarefa</button>' : ""}
    </div>
    ${admin && socios.length ? `<p class="text-sm text-ink/70 mb-3">Cores: ${socios.map((s) => `<span class="tag" style="${estiloPessoa(s.uid)}">${esc(s.nome)}</span>`).join(" ")} · tarefas suas ficam com a borda laranja.</p>` : ""}
    <div id="quadro" class="kanban"></div>
    <dialog id="dlg"><form id="form" class="space-y-4"><h2 class="h2" id="tit"></h2>
      <label>Título<input name="titulo" required maxlength="200" class="input"></label>
      <label>Descrição<textarea name="descricao" rows="2" maxlength="500" class="input"></textarea></label>
      <fieldset><legend class="text-sm font-semibold text-ink/70 mb-2">Quem faz (escolha uma ou mais pessoas)</legend>
        <div class="grid gap-2">${pessoas.map((p) => `<label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="resp" value="${p.uid}"> ${esc(p.nome)} <span class="tag">${PAPEL[p.papel] || p.papel}</span></label>`).join("")}</div></fieldset>
      <div class="grid grid-cols-2 gap-4"><label>Prazo<input name="prazo" type="date" class="input"></label>
        <label>Tipo<select name="tipo" class="input"><option value="tarefa">Implantação / rotina</option><option value="melhoria">Ponto a melhorar</option></select></label></div>
      <label>Etapas do checklist (uma por linha)<textarea name="etapas" rows="4" class="input"></textarea></label>
      <p class="text-xs text-ink/70">A tarefa só pode ser concluída quando todas as etapas estiverem marcadas.</p>
      <div class="flex gap-3 justify-end"><button type="button" id="cancelar" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog></div>`;

  const raiz = el.querySelector("#raiz"), dlg = raiz.querySelector("#dlg"), form = raiz.querySelector("#form");

  function cartao(t, ci, hoje) {
    const ck = t.checklist || [], feitos = ck.length - pendentes(t), minha = (t.responsaveis || []).includes(uid);
    const atras = t.prazo && t.prazo < hoje && t.status !== "concluido";
    const trava = COLS[ci + 1]?.[0] === "concluido" && pendentes(t) > 0;
    const nomes = t.responsaveisNomes || [];
    return `<article class="card mb-4 ${admin && minha ? "minha" : ""}">
      <p class="font-semibold">${esc(t.titulo)}</p>${t.descricao ? `<p class="text-sm text-ink/70 mt-1">${esc(t.descricao)}</p>` : ""}
      <div class="flex flex-wrap gap-2 mt-3">
        ${(t.responsaveis || []).map((id, i) => `<span class="tag" style="${admin ? estiloPessoa(id) : ""}">${esc(nomes[i] || "")}</span>`).join("") || '<span class="tag bad">Sem responsável</span>'}
        ${admin && minha ? '<span class="tag ok">Minha</span>' : ""}
        ${t.tipo === "melhoria" ? '<span class="tag" style="background:#ffb067;color:#272928">Melhoria</span>' : ""}
        ${t.prazo ? `<span class="tag ${atras ? "bad" : ""}">${atras ? "Atrasada · " : "até "}${fmtDia(t.prazo)}</span>` : ""}</div>
      ${ck.length ? `<div class="mt-3 text-sm text-ink/70">${feitos}/${ck.length} etapas</div>
        ${ck.map((c, i) => `<label class="flex gap-3 items-start text-sm py-1" style="color:inherit;font-weight:400"><input type="checkbox" class="mt-1" data-act="ck" data-id="${t.id}" data-i="${i}" ${c.feito ? "checked" : ""}><span>${esc(c.texto)}</span></label>`).join("")}` : ""}
      <div class="flex flex-wrap gap-3 mt-4">
        ${ci > 0 ? `<button class="btn-alt" data-act="mv" data-d="-1" data-id="${t.id}">Voltar</button>` : ""}
        ${ci < 2 ? (trava ? `<button class="btn-alt" disabled>Faltam ${pendentes(t)} etapas</button>` : `<button class="btn-alt" data-act="mv" data-d="1" data-id="${t.id}">Avançar</button>`) : ""}
        ${admin ? `<button class="btn-alt" data-act="ed" data-id="${t.id}">Editar</button><button class="btn-alt" data-act="del" data-id="${t.id}">Excluir</button>` : ""}</div></article>`;
  }

  function desenhar() {
    raiz.querySelector("#abas").innerHTML = [["todas", "Todas"], ["tarefa", "Implantação"], ["melhoria", "Pontos a melhorar"]].map(([k, l]) => `<button class="btn-alt ${tipo === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    const hoje = hojeISO();
    const vis = tarefas.filter((t) => (tipo === "todas" || t.tipo === tipo) && (quem === "todos" || (quem === "minhas" ? (t.responsaveis || []).includes(uid) : (t.responsaveis || []).includes(quem))))
      .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
    raiz.querySelector("#quadro").innerHTML = !tarefas.length && !admin
      ? '<div class="card" style="flex:1">Você não tem tarefas atribuídas no momento.</div>'
      : COLS.map(([k, nome], ci) => { const col = vis.filter((t) => t.status === k);
          return `<section><h3 class="font-bold mb-3">${nome} <span class="text-ink/70 text-sm">${col.length}</span></h3>${col.map((t) => cartao(t, ci, hoje)).join("") || '<p class="text-ink/70 text-sm">Nada aqui.</p>'}</section>`; }).join("");
  }

  function abrir(t) {
    editando = t || null; form.reset();
    raiz.querySelector("#tit").textContent = t ? "Editar tarefa" : "Nova tarefa";
    const f = form.elements;
    if (t) {
      f.titulo.value = t.titulo; f.descricao.value = t.descricao || ""; f.prazo.value = t.prazo || ""; f.tipo.value = t.tipo || "tarefa";
      f.etapas.value = (t.checklist || []).map((c) => c.texto).join("\n");
      form.querySelectorAll('[name="resp"]').forEach((c) => { c.checked = (t.responsaveis || []).includes(c.value); });
    }
    dlg.showModal();
  }

  // Tarefas antigas tinham só um nome ("Davi", "Ambos", "Gerente"): converte para pessoas reais (uma vez, só sócio)
  async function migrar() {
    migrou = true;
    const velhas = tarefas.filter((t) => !Array.isArray(t.responsaveis));
    if (!velhas.length) return;
    const lote = writeBatch(db);
    velhas.forEach((t) => {
      const r = String(t.responsavel || "").toLowerCase();
      const alvo = r === "ambos" ? socios : r === "gerente" ? pessoas.filter((p) => p.papel === "gerente") : pessoas.filter((p) => p.nome.toLowerCase() === r);
      lote.update(doc(db, "tarefas", t.id), { responsaveis: alvo.map((p) => p.uid), responsaveisNomes: alvo.map((p) => p.nome) });
    });
    try { await lote.commit(); toast(`${velhas.length} tarefas antigas foram vinculadas às pessoas. Confira as que ficaram "Sem responsável".`); } catch (e) { erro(e); }
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
        if (COLS[i][0] === "concluido" && pendentes(t) > 0) return toast(`Faltam ${pendentes(t)} etapas do checklist para concluir.`);
        await updateDoc(doc(db, "tarefas", t.id), { status: COLS[i][0], atualizadoEm: serverTimestamp() });
        if (COLS[i][0] === "concluido") await auditar(perfil, "tarefa_concluida", t.titulo);
      } else if (b.dataset.act === "ed") abrir(t);
      else if (b.dataset.act === "del" && confirm(`Excluir a tarefa "${t.titulo}"?`)) { await deleteDoc(doc(db, "tarefas", t.id)); await auditar(perfil, "tarefa_excluida", t.titulo); }
    } catch (err) { erro(err); }
  });

  raiz.addEventListener("change", async (e) => {
    if (e.target.id === "fquem") { quem = e.target.value; return desenhar(); }
    const c = e.target.closest('input[data-act="ck"]');
    if (!c) return;
    const t = tarefas.find((x) => x.id === c.dataset.id);
    const checklist = t.checklist.map((x, i) => (i === Number(c.dataset.i) ? { ...x, feito: c.checked } : x));
    const dados = { checklist, atualizadoEm: serverTimestamp() };
    if (!c.checked && t.status === "concluido") { dados.status = "andamento"; toast("Etapa desmarcada: a tarefa voltou para Em andamento."); }
    else if (c.checked && checklist.every((x) => x.feito)) toast("Todas as etapas feitas. Já pode concluir a tarefa.");
    try { await updateDoc(doc(db, "tarefas", t.id), dados); } catch (err) { erro(err); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)), ids = [...form.querySelectorAll('[name="resp"]:checked')].map((c) => c.value);
    if (!ids.length) return toast("Escolha pelo menos uma pessoa para fazer a tarefa.");
    const antigas = editando?.checklist || [];
    const checklist = d.etapas.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50).map((texto) => ({ texto, feito: antigas.some((c) => c.texto === texto && c.feito) }));
    const nomes = ids.map((id) => pessoas.find((p) => p.uid === id)?.nome || "");
    let status = editando?.status || "a_fazer";
    if (status === "concluido" && checklist.some((c) => !c.feito)) status = "andamento"; // novas etapas reabrem a tarefa
    const dados = { titulo: d.titulo.trim(), descricao: d.descricao.trim(), tipo: d.tipo, prazo: d.prazo || "", checklist, status,
      responsaveis: ids, responsaveisNomes: nomes, responsavel: nomes.join(", "), atualizadoEm: serverTimestamp() };
    try {
      if (editando) await updateDoc(doc(db, "tarefas", editando.id), dados);
      else { await addDoc(collection(db, "tarefas"), { ...dados, criadoPor: perfil.nome, criadoEm: serverTimestamp() }); await auditar(perfil, "tarefa_criada", dados.titulo); }
      dlg.close(); toast("Tarefa salva.");
    } catch (err) { erro(err); }
  });

  // Sócio lê tudo; os demais só recebem as tarefas em que estão como responsáveis (as regras garantem isso no servidor)
  const origem = admin ? collection(db, "tarefas") : query(collection(db, "tarefas"), where("responsaveis", "array-contains", uid));
  const parar = onSnapshot(origem, (s) => {
    tarefas = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    desenhar();
    if (admin && !migrou) migrar();
  }, erro);
  desenhar();
  return parar;
}
