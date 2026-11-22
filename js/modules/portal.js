import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, hojeISO, fmtDia, fmtData } from "../util.js";
import { carregarEquipe } from "../core/equipe.js";
import { TIPOS_PONTO, diaFortaleza, horaFortaleza, fmtHoras, proximosTipos, situacao, agruparTurnos, totalSegundos, mesAtual, inicioMesMs, fimMesMs } from "../core/ponto.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, arrayUnion, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(traduzErro(e)); };
const SIT = { fora: "Fora do expediente", trabalhando: "Trabalhando", intervalo: "Em intervalo", esquecido: "Turno aberto há muito tempo (esqueceu a saída?)" };
const ST_AJ = { pendente: ["", "Aguardando aprovação"], aprovado: ["ok", "Aprovado"], recusado: ["bad", "Recusado"] };

export async function render(el, { perfil }) {
  const uid = perfil.uid, admin = perfil.papel === "admin", operacional = admin || perfil.papel === "gerente", temPonto = !admin;
  const equipe = await carregarEquipe(perfil);
  const nomeDe = (id) => equipe.find((m) => m.uid === id)?.nome || "";
  let coms = [], manual = [], regs = [], ajustes = [], aba = "inicio", editando = null, tipoCom = "alerta";
  const ABAS = [["inicio", "Alertas e notícias"], ["manual", "Manual"], ...(temPonto ? [["ponto", "Ponto"]] : [])];

  el.innerHTML = `<div id="raiz">
    <div id="abas" class="flex flex-wrap gap-3 mb-5"></div>
    <div id="acoes" class="flex flex-wrap gap-3 mb-5"></div>
    <div id="corpo"></div>
    <dialog id="dC"><form id="fC" class="space-y-4"><h2 class="h2" id="tC"></h2>
      <label>Título<input name="titulo" required maxlength="120" class="input"></label>
      <label data-nivel>Nível<select name="nivel" class="input"><option value="urgente">Urgente</option><option value="aviso">Aviso</option></select></label>
      <label>Texto<textarea name="texto" rows="5" maxlength="2000" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dC" class="btn-alt">Cancelar</button><button class="btn">Publicar</button></div></form></dialog>
    <dialog id="dM"><form id="fM" class="space-y-4"><h2 class="h2" id="tM"></h2>
      <label>Título da seção<input name="titulo" required maxlength="120" class="input"></label>
      <label>Ordem no manual<input name="ordem" inputmode="numeric" class="input"></label>
      <label>Texto<textarea name="texto" rows="9" maxlength="5000" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dM" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog>
    <dialog id="dA"><form id="fA" class="space-y-4"><h2 class="h2">Esqueci de bater o ponto</h2>
      <p class="text-ink/70">Informe o que faltou. Um sócio ou o gerente precisa aprovar antes de valer.</p>
      <div class="grid grid-cols-2 gap-4"><label>Dia<input name="dia" type="date" required class="input"></label><label>Hora<input name="hora" type="time" required class="input"></label></div>
      <label>O que faltou<select name="tipo" class="input">${Object.entries(TIPOS_PONTO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Justificativa<input name="justificativa" required minlength="3" maxlength="200" class="input" placeholder="Ex.: celular sem bateria"></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dA" class="btn-alt">Cancelar</button><button class="btn">Enviar pedido</button></div></form></dialog>
  </div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo");
  const dC = raiz.querySelector("#dC"), dM = raiz.querySelector("#dM"), dA = raiz.querySelector("#dA");
  const fC = raiz.querySelector("#fC"), fM = raiz.querySelector("#fM"), fA = raiz.querySelector("#fA");

  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    raiz.querySelector("#acoes").innerHTML = !operacional ? "" : aba === "inicio"
      ? `<button class="btn" data-act="novoCom" data-tipo="alerta">Novo alerta</button><button class="btn-alt" data-act="novoCom" data-tipo="noticia">Nova notícia</button>`
      : aba === "manual" ? `<button class="btn" data-act="novoMan">Nova seção</button>` : "";
    atualizar();
  }
  const atualizar = () => (aba === "inicio" ? aInicio : aba === "manual" ? aManual : aPonto)();

  // ===== Alertas e notícias =====
  function aInicio() {
    const ativos = coms.filter((c) => c.ativo !== false).sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));
    const card = (c) => {
      const ciente = (c.cientes || []).includes(uid), faltam = equipe.filter((m) => !(c.cientes || []).includes(m.uid));
      return `<div class="card mb-4" ${c.tipo === "alerta" ? 'style="border-left:10px solid var(--orange)"' : ""}>
        <div class="flex items-start gap-3"><h3 class="h2 flex-1">${esc(c.titulo)}</h3>${c.tipo === "alerta" ? `<span class="tag ${c.nivel === "urgente" ? "bad" : ""}">${c.nivel === "urgente" ? "Urgente" : "Aviso"}</span>` : ""}</div>
        <p class="whitespace-pre-wrap mt-2">${esc(c.texto)}</p>
        <p class="text-xs text-ink/70 mt-3">${fmtData(c.criadoEm)} · ${esc(c.autor || "")}</p>
        <div class="flex flex-wrap items-center gap-3 mt-3">
          ${c.tipo === "alerta" && temPonto ? (ciente ? '<span class="tag ok">Ciente</span>' : `<button class="btn" data-act="ciente" data-id="${c.id}">Estou ciente</button>`) : ""}
          ${operacional && c.tipo === "alerta" ? `<span class="tag">${(c.cientes || []).length} de ${equipe.length} cientes</span>${faltam.length ? `<small class="text-ink/70">Faltam: ${faltam.map((m) => esc(m.nome)).join(", ")}</small>` : ""}` : ""}
          ${operacional ? `<button class="btn-alt" data-act="editCom" data-id="${c.id}">Editar</button><button class="btn-alt" data-act="arquivar" data-id="${c.id}">Arquivar</button>` : ""}
          ${admin ? `<button class="btn-alt" data-act="delCom" data-id="${c.id}">Excluir</button>` : ""}</div></div>`;
    };
    const al = ativos.filter((c) => c.tipo === "alerta"), no = ativos.filter((c) => c.tipo !== "alerta");
    corpo.innerHTML = `<h3 class="h2 mb-3">Alertas</h3>${al.map(card).join("") || '<div class="card mb-4">Nenhum alerta no momento.</div>'}
      <h3 class="h2 mb-3 mt-6">Notícias e comunicados</h3>${no.map(card).join("") || '<div class="card">Nenhuma notícia.</div>'}`;
  }

  function abrirCom(c, tipo) {
    editando = c || null; tipoCom = c ? c.tipo : tipo;
    raiz.querySelector("#tC").textContent = `${c ? "Editar" : "Novo"} ${tipoCom === "alerta" ? "alerta" : "comunicado"}`;
    fC.reset(); fC.querySelector("[data-nivel]").classList.toggle("hidden", tipoCom !== "alerta");
    if (c) { fC.elements.titulo.value = c.titulo; fC.elements.texto.value = c.texto; if (c.nivel) fC.elements.nivel.value = c.nivel; }
    dC.showModal();
  }
  async function salvarCom() {
    const d = Object.fromEntries(new FormData(fC));
    const dados = { tipo: tipoCom, titulo: d.titulo.trim(), texto: d.texto.trim(), ativo: true, ...(tipoCom === "alerta" ? { nivel: d.nivel } : {}) };
    if (editando) await updateDoc(doc(db, "comunicados", editando.id), { ...dados, ativo: editando.ativo !== false, atualizadoEm: serverTimestamp() });
    else await addDoc(collection(db, "comunicados"), { ...dados, cientes: [], autor: perfil.nome, criadoEm: serverTimestamp() });
    await auditar(perfil, editando ? "comunicado_editado" : "comunicado_publicado", dados.titulo);
    dC.close(); toast("Publicado.");
  }

  // ===== Manual =====
  function aManual() {
    const l = [...manual].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    corpo.innerHTML = l.length ? l.map((m) => `<details class="card mb-3"><summary class="h2" style="list-style:revert">${esc(m.titulo)}</summary>
      <p class="whitespace-pre-wrap mt-3">${esc(m.texto)}</p>
      ${operacional ? `<div class="flex gap-3 mt-4"><button class="btn-alt" data-act="editMan" data-id="${m.id}">Editar</button>${admin ? `<button class="btn-alt" data-act="delMan" data-id="${m.id}">Excluir</button>` : ""}</div>` : ""}</details>`).join("")
      : `<div class="card">${operacional ? 'O manual está vazio. Toque em "Nova seção" para começar (ex.: Boas-vindas, Higiene, Uniforme, Ponto).' : "O manual ainda não foi publicado."}</div>`;
  }
  function abrirMan(m) {
    editando = m || null;
    raiz.querySelector("#tM").textContent = m ? "Editar seção" : "Nova seção do manual";
    fM.reset();
    fM.elements.ordem.value = m ? m.ordem : (Math.max(0, ...manual.map((x) => x.ordem || 0)) + 1);
    if (m) { fM.elements.titulo.value = m.titulo; fM.elements.texto.value = m.texto; }
    dM.showModal();
  }
  async function salvarMan() {
    const d = Object.fromEntries(new FormData(fM)), ordem = Number(d.ordem) || 1;
    const dados = { titulo: d.titulo.trim(), texto: d.texto.trim(), ordem };
    if (editando) await updateDoc(doc(db, "manual", editando.id), { ...dados, atualizadoEm: serverTimestamp() });
    else await addDoc(collection(db, "manual"), { ...dados, criadoEm: serverTimestamp() });
    await auditar(perfil, "manual_salvo", dados.titulo);
    dM.close(); toast("Seção salva.");
  }

  // ===== Ponto =====
  function aPonto() {
    const agora = Date.now(), ult = regs[0], sit = situacao(ult, agora), prox = proximosTipos(ult, agora);
    const turnos = agruparTurnos([...regs].reverse()), mes = mesAtual();
    const doMes = turnos.filter((t) => (t.inicio ?? t.regs[0].ms) >= inicioMesMs(mes) && (t.inicio ?? t.regs[0].ms) < fimMesMs(mes));
    const turnoAtual = turnos[turnos.length - 1]?.aberto ? turnos[turnos.length - 1] : null;
    const btns = prox.map((t, i) => `<button class="${i === 0 ? "btn" : "btn-alt"}" style="${i === 0 ? "min-height:68px;font-size:1.3rem" : ""}" data-act="bater" data-tipo="${t}">${i === 0 ? "Bater ponto: " : ""}${TIPOS_PONTO[t]}</button>`).join("");
    const dias = [...new Set(turnos.map((t) => t.dia))].sort().reverse().slice(0, 14);
    corpo.innerHTML = `<div class="card text-center" style="max-width:34rem">
        <div class="text-ink/70">${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Fortaleza" })}</div>
        <div class="num" id="rel" style="font-size:3.4rem;margin:6px 0">${horaFortaleza(agora, true)}</div>
        <p class="font-semibold">${SIT[sit]}${turnoAtual ? ` · desde ${horaFortaleza(turnoAtual.inicio)}` : ""}</p>
        <div class="grid gap-3 mt-4">${btns}</div></div>
      <div class="card mt-5" style="max-width:34rem"><div class="flex items-center gap-3"><h3 class="h2 flex-1">Meus últimos dias</h3><button class="btn-alt" data-act="esqueci">Esqueci de bater</button></div>
        <p class="text-ink/70 text-sm mt-1">Total no mês: <b>${fmtHoras(totalSegundos(doMes))}</b> em ${doMes.filter((t) => !t.incompleto).length} dias</p>
        ${dias.length ? `<table><tr><th>Dia</th><th>Registros</th><th>Total</th></tr>${dias.map((d) => {
          const ts = turnos.filter((t) => t.dia === d);
          return `<tr><td>${fmtDia(d)}</td><td>${ts.flatMap((t) => t.regs).map((r) => horaFortaleza(r.ms) + (r.origem === "ajuste" ? "*" : "")).join(" · ")}</td>
            <td>${ts.some((t) => t.incompleto) ? '<span class="tag bad">Incompleto</span>' : fmtHoras(totalSegundos(ts))}</td></tr>`;
        }).join("")}</table><p class="text-xs text-ink/70 mt-2">* registro lançado por ajuste aprovado.</p>` : '<p class="mt-3 text-ink/70">Nenhum registro ainda.</p>'}</div>
      ${ajustes.length ? `<div class="card mt-5" style="max-width:34rem"><h3 class="h2 mb-2">Meus pedidos de ajuste</h3><table><tr><th>Quando</th><th>Tipo</th><th>Situação</th></tr>
        ${[...ajustes].sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0)).slice(0, 8).map((a) => {
          const [c, r] = ST_AJ[a.status] || ["", a.status];
          return `<tr><td>${fmtDia(a.dia)} ${horaFortaleza(a.em.toMillis())}</td><td>${TIPOS_PONTO[a.tipo]}</td><td><span class="tag ${c}">${r}</span></td></tr>`;
        }).join("")}</table></div>` : ""}`;
  }

  async function bater(tipo) {
    const ult = regs[0];
    if (!proximosTipos(ult, Date.now()).includes(tipo)) return toast("Esse registro não é o próximo da sequência. Atualize a tela.");
    if (ult && Date.now() - ult.ms < 15000) return toast("Você acabou de registrar. Aguarde alguns segundos.");
    await addDoc(collection(db, "ponto", uid, "registros"), { tipo, em: serverTimestamp(), origem: "ponto", por: uid, porNome: perfil.nome });
    toast(`${TIPOS_PONTO[tipo]} registrada às ${horaFortaleza(Date.now())}.`);
  }
  async function pedirAjuste() {
    const d = Object.fromEntries(new FormData(fA)), ms = Date.parse(`${d.dia}T${d.hora}:00-03:00`);
    if (!(ms <= Date.now())) return toast("O horário não pode estar no futuro.");
    if (Date.now() - ms > 45 * 864e5) return toast("Só é possível pedir ajuste de até 45 dias atrás.");
    await addDoc(collection(db, "ajustes_ponto"), { uid, nome: perfil.nome, tipo: d.tipo, dia: d.dia, em: Timestamp.fromMillis(ms), justificativa: d.justificativa.trim(), status: "pendente", criadoEm: serverTimestamp() });
    dA.close(); toast("Pedido enviado para aprovação.");
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return montar(); }
    const fc = e.target.closest("[data-fechar]");
    if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act, c = coms.find((x) => x.id === b.dataset.id), m = manual.find((x) => x.id === b.dataset.id);
    b.disabled = true;
    try {
      if (a === "novoCom") abrirCom(null, b.dataset.tipo);
      else if (a === "editCom") abrirCom(c);
      else if (a === "ciente") { await updateDoc(doc(db, "comunicados", c.id), { cientes: arrayUnion(uid) }); toast("Ciência registrada."); }
      else if (a === "arquivar") { await updateDoc(doc(db, "comunicados", c.id), { ativo: false }); toast("Arquivado."); }
      else if (a === "delCom" && confirm(`Excluir "${c.titulo}"?`)) await deleteDoc(doc(db, "comunicados", c.id));
      else if (a === "novoMan") abrirMan(null);
      else if (a === "editMan") abrirMan(m);
      else if (a === "delMan" && confirm(`Excluir a seção "${m.titulo}"?`)) await deleteDoc(doc(db, "manual", m.id));
      else if (a === "bater") await bater(b.dataset.tipo);
      else if (a === "esqueci") { fA.reset(); fA.elements.dia.value = hojeISO(); fA.elements.dia.max = hojeISO(); dA.showModal(); }
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });
  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn"); btn.disabled = true;
    try { if (e.target.id === "fC") await salvarCom(); else if (e.target.id === "fM") await salvarMan(); else if (e.target.id === "fA") await pedirAjuste(); }
    catch (err) { erro(err); } finally { btn.disabled = false; }
  });

  // ---------- dados em tempo real ----------
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
  const paradas = [
    onSnapshot(collection(db, "comunicados"), (s) => { coms = ver(s); if (aba === "inicio") aInicio(); }, erro),
    onSnapshot(collection(db, "manual"), (s) => { manual = ver(s); if (aba === "manual") aManual(); }, erro)
  ];
  if (temPonto) {
    paradas.push(onSnapshot(query(collection(db, "ponto", uid, "registros"), orderBy("em", "desc"), limit(150)),
      (s) => { regs = ver(s).map((r) => ({ ...r, ms: r.em.toMillis() })); if (aba === "ponto") aPonto(); }, erro));
    paradas.push(onSnapshot(query(collection(db, "ajustes_ponto"), where("uid", "==", uid)),
      (s) => { ajustes = ver(s); if (aba === "ponto") aPonto(); }, erro));
  }
  const relogio = setInterval(() => { const r = raiz.querySelector("#rel"); if (r) r.textContent = horaFortaleza(Date.now(), true); }, 1000);
  montar();
  return () => { clearInterval(relogio); paradas.forEach((p) => p()); };
}
