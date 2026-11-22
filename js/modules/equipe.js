import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, fmtDia } from "../util.js";
import { carregarEquipe } from "../core/equipe.js";
import { TIPOS_PONTO, horaFortaleza, fmtHoras, situacao, agruparTurnos, totalSegundos, mesAtual, inicioMesMs, fimMesMs } from "../core/ponto.js";
import {
  collection, doc, onSnapshot, updateDoc, setDoc, runTransaction, query, where, orderBy, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(e.message === "JA_FEITO" ? "Este pedido já foi decidido por outra pessoa." : traduzErro(e)); };
const csvCel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const SIT = { fora: ["", "Fora"], trabalhando: ["ok", "Trabalhando"], intervalo: ["", "Em intervalo"], esquecido: ["bad", "Turno aberto (saída esquecida?)"] };
const ST_AJ = { pendente: ["", "Pendente"], aprovado: ["ok", "Aprovado"], recusado: ["bad", "Recusado"] };

export async function render(el, { perfil }) {
  const admin = perfil.papel === "admin", uid = perfil.uid;
  const equipe = await carregarEquipe(perfil);
  let aba = "hoje", mes = mesAtual(), reg = {}, ajustes = [], fichas = {}, fFunc = "", editando = null, subs = [];

  el.innerHTML = `<div id="raiz">
    <div id="abas" class="flex flex-wrap gap-3 mb-5"></div><div id="corpo"></div>
    <dialog id="dF"><form id="fF" class="space-y-4"><h2 class="h2" id="tF"></h2>
      <label>Cargo<input name="cargo" maxlength="60" class="input" placeholder="Ex.: Chapeiro, Atendente"></label>
      <div class="grid grid-cols-2 gap-4"><label>Telefone / WhatsApp<input name="telefone" maxlength="30" class="input"></label>
        <label>Data de admissão<input name="admissao" type="date" class="input"></label></div>
      <label>Jornada diária (horas)<input name="jornada" inputmode="decimal" class="input" placeholder="Ex.: 8"></label>
      <label>Observações<textarea name="obs" rows="3" maxlength="400" class="input"></textarea></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dF" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog>
  </div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo"), dF = raiz.querySelector("#dF"), fF = raiz.querySelector("#fF");
  const ABAS = [["hoje", "Hoje"], ["registros", "Espelho de ponto"], ["ajustes", "Ajustes"], ["fichas", "Funcionários"]];
  const pendentes = () => ajustes.filter((a) => a.status === "pendente").length;

  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}${k === "ajustes" && pendentes() ? ` (${pendentes()})` : ""}</button>`).join("");
    atualizar();
  }
  const atualizar = () => (aba === "hoje" ? vHoje : aba === "registros" ? vRegistros : aba === "ajustes" ? vAjustes : vFichas)();

  // ---------- Hoje ----------
  function vHoje() {
    const agora = Date.now();
    corpo.innerHTML = !equipe.length ? '<div class="card">Nenhum funcionário ativo. Cadastre em Usuários.</div>' : `<div class="card"><table>
      <tr><th>Funcionário</th><th>Situação</th><th>Último registro</th><th>Turno</th></tr>
      ${equipe.map((m) => {
        const r = reg[m.uid] || [], ult = r[r.length - 1], sit = situacao(ult, agora), t = agruparTurnos(r).slice(-1)[0];
        const [cls, rot] = SIT[sit];
        return `<tr><td><b>${esc(m.nome)}</b><br><small class="text-ink/70">${m.papel === "gerente" ? "Gerente" : "Funcionário"}</small></td><td><span class="tag ${cls}">${rot}</span></td>
          <td>${ult ? `${TIPOS_PONTO[ult.tipo]} às ${horaFortaleza(ult.ms)}` : "—"}</td><td>${t?.aberto ? `desde ${horaFortaleza(t.inicio)}` : t && !t.incompleto ? fmtHoras(t.segundos) : "—"}</td></tr>`;
      }).join("")}</table></div>
      <p class="text-xs text-ink/70 mt-2">Os horários vêm do relógio do servidor, não do celular do funcionário.</p>`;
  }

  // ---------- Espelho de ponto ----------
  function linhasEspelho() {
    const ini = inicioMesMs(mes), fim = fimMesMs(mes), out = [];
    for (const m of equipe.filter((x) => !fFunc || x.uid === fFunc)) {
      const ts = agruparTurnos(reg[m.uid] || []).filter((t) => { const k = t.inicio ?? t.regs[0].ms; return k >= ini && k < fim; });
      out.push({ m, ts, total: totalSegundos(ts), dias: ts.filter((t) => !t.incompleto).length, inc: ts.filter((t) => t.incompleto).length });
    }
    return out;
  }
  function vRegistros() {
    const l = linhasEspelho();
    corpo.innerHTML = `<div class="flex flex-wrap items-end gap-3 mb-4 no-print">
        <label>Mês<input id="mes" type="month" class="input" value="${mes}" style="margin:0"></label>
        <label>Funcionário<select id="ff" class="input" style="margin:0;width:auto"><option value="">Todos</option>${equipe.map((m) => `<option value="${m.uid}" ${fFunc === m.uid ? "selected" : ""}>${esc(m.nome)}</option>`).join("")}</select></label>
        <span class="flex-1"></span><button class="btn-alt" data-act="csv">Exportar CSV</button><button class="btn-alt" data-act="imprimir">Imprimir / PDF</button></div>
      ${l.map(({ m, ts, total, dias, inc }) => `<div class="card mb-4"><div class="flex flex-wrap items-center gap-3"><h3 class="h2 flex-1">${esc(m.nome)}</h3>
          <span class="tag">${fmtHoras(total)} em ${dias} dias</span>${inc ? `<span class="tag bad">${inc} incompleto(s)</span>` : ""}</div>
        ${ts.length ? `<table><tr><th>Dia</th><th>Registros</th><th>Total</th></tr>${[...ts].sort((a, b) => b.dia.localeCompare(a.dia)).map((t) => `<tr><td>${fmtDia(t.dia)}</td>
          <td>${t.regs.map((r) => horaFortaleza(r.ms) + (r.origem === "ajuste" ? "*" : "")).join(" · ")}</td>
          <td>${t.incompleto ? '<span class="tag bad">Incompleto</span>' : fmtHoras(t.segundos)}</td></tr>`).join("")}</table>` : '<p class="text-ink/70 mt-2">Sem registros neste mês.</p>'}</div>`).join("")}
      <p class="text-xs text-ink/70">* registro lançado por ajuste aprovado. O turno conta no dia em que começou, mesmo que termine depois da meia-noite.</p>`;
  }
  function exportarCSV() {
    const cab = ["Funcionário", "Dia", "Registros", "Total (horas)", "Situação"];
    const linhas = linhasEspelho().flatMap(({ m, ts }) => ts.map((t) => [m.nome, t.dia, t.regs.map((r) => `${TIPOS_PONTO[r.tipo]} ${horaFortaleza(r.ms)}${r.origem === "ajuste" ? "*" : ""}`).join(" | "),
      t.segundos == null ? "" : String(Math.round(t.segundos / 36) / 100).replace(".", ","), t.incompleto ? "incompleto" : "ok"].map(csvCel).join(";")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + [cab.map(csvCel).join(";"), ...linhas].join("\r\n")], { type: "text/csv" }));
    a.download = `espelho-de-ponto-${mes}.csv`; a.click();
  }

  // ---------- Ajustes ----------
  function vAjustes() {
    const l = [...ajustes].sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));
    corpo.innerHTML = !l.length ? '<div class="card">Nenhum pedido de ajuste.</div>' : l.map((a) => {
      const [cls, rot] = ST_AJ[a.status] || ["", a.status], proprio = a.uid === uid;
      return `<div class="card mb-4"><div class="flex items-start gap-3"><h3 class="h2 flex-1">${esc(a.nome)}: ${TIPOS_PONTO[a.tipo]}</h3><span class="tag ${cls}">${rot}</span></div>
        <p class="mt-1"><b>${fmtDia(a.dia)} às ${horaFortaleza(a.em.toMillis())}</b></p><p class="text-ink/70">${esc(a.justificativa)}</p>
        ${a.status === "pendente" ? `<div class="flex flex-wrap gap-3 mt-4">${proprio ? '<span class="tag">Precisa ser aprovado por um sócio</span>'
          : `<button class="btn" data-act="aprovar" data-id="${a.id}">Aprovar</button><button class="btn-alt" data-act="recusar" data-id="${a.id}">Recusar</button>`}</div>`
          : `<p class="text-xs text-ink/70 mt-2">${rot} por ${esc(a.decididoPorNome || "")}</p>`}</div>`;
    }).join("");
  }
  async function decidir(a, aprovar) {
    const ref = doc(db, "ajustes_ponto", a.id);
    await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).data().status !== "pendente") throw new Error("JA_FEITO");
      tx.update(ref, { status: aprovar ? "aprovado" : "recusado", decididoPor: uid, decididoPorNome: perfil.nome, decididoEm: serverTimestamp() });
      if (aprovar) tx.set(doc(db, "ponto", a.uid, "registros", "aj_" + a.id), {
        tipo: a.tipo, em: a.em, origem: "ajuste", ajusteId: a.id, aprovadoPor: uid, aprovadoPorNome: perfil.nome, justificativa: a.justificativa, por: a.uid, porNome: a.nome
      });
    });
    await auditar(perfil, aprovar ? "ponto_ajuste_aprovado" : "ponto_ajuste_recusado", `${a.nome}: ${TIPOS_PONTO[a.tipo]} em ${a.dia} ${horaFortaleza(a.em.toMillis())}`);
    toast(aprovar ? "Ajuste aprovado e lançado no ponto." : "Pedido recusado.");
  }

  // ---------- Fichas ----------
  function vFichas() {
    corpo.innerHTML = !equipe.length ? '<div class="card">Nenhum funcionário ativo.</div>' : `<div class="card"><table><tr><th>Nome</th><th>Cargo</th><th>Telefone</th><th>Jornada</th><th>Admissão</th>${admin ? "<th></th>" : ""}</tr>
      ${equipe.map((m) => { const f = fichas[m.uid] || {}; return `<tr><td><b>${esc(m.nome)}</b><br><small class="text-ink/70">${esc(m.email || "")}</small></td><td>${esc(f.cargo || "—")}</td>
        <td>${f.telefone ? `<a class="underline text-brand-dark" href="https://wa.me/${f.telefone.replace(/\D/g, "").length <= 11 ? "55" : ""}${f.telefone.replace(/\D/g, "")}" target="_blank" rel="noopener">${esc(f.telefone)}</a>` : "—"}</td>
        <td>${f.jornada ? f.jornada + " h/dia" : "—"}</td><td>${f.admissao ? fmtDia(f.admissao) : "—"}</td>
        ${admin ? `<td><button class="btn-alt" data-act="editF" data-id="${m.uid}">Editar</button></td>` : ""}</tr>`; }).join("")}</table></div>`;
  }
  function abrirFicha(m) {
    editando = m; raiz.querySelector("#tF").textContent = `Ficha · ${m.nome}`;
    fF.reset(); const f = fichas[m.uid] || {}, x = fF.elements;
    x.cargo.value = f.cargo || ""; x.telefone.value = f.telefone || ""; x.admissao.value = f.admissao || ""; x.jornada.value = f.jornada ? String(f.jornada).replace(".", ",") : ""; x.obs.value = f.obs || "";
    dF.showModal();
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; if (aba === "hoje" && mes !== mesAtual()) { mes = mesAtual(); assinar(); } return montar(); }
    const fc = e.target.closest("[data-fechar]");
    if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act, aj = ajustes.find((x) => x.id === b.dataset.id);
    b.disabled = true;
    try {
      if (a === "aprovar") await decidir(aj, true);
      else if (a === "recusar") { if (confirm(`Recusar o pedido de ${aj.nome}?`)) await decidir(aj, false); }
      else if (a === "editF") abrirFicha(equipe.find((m) => m.uid === b.dataset.id));
      else if (a === "csv") exportarCSV();
      else if (a === "imprimir") window.print();
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });
  raiz.addEventListener("change", (e) => {
    if (e.target.id === "mes" && e.target.value) { mes = e.target.value; assinar(); vRegistros(); }
    else if (e.target.id === "ff") { fFunc = e.target.value; vRegistros(); }
  });
  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id !== "fF") return;
    const d = Object.fromEntries(new FormData(fF)), j = d.jornada ? Number(String(d.jornada).replace(",", ".")) : null;
    if (j !== null && !(j > 0 && j <= 24)) return toast("Jornada inválida (de 1 a 24 horas).");
    try {
      await setDoc(doc(db, "funcionarios", editando.uid), { cargo: d.cargo.trim(), telefone: d.telefone.trim(), admissao: d.admissao || "", jornada: j, obs: d.obs.trim(), atualizadoEm: serverTimestamp() }, { merge: true });
      await auditar(perfil, "ficha_funcionario_salva", editando.nome);
      dF.close(); toast("Ficha salva.");
    } catch (err) { erro(err); }
  });

  // ---------- dados em tempo real ----------
  function assinar() {
    subs.splice(0).forEach((u) => u());
    const de = Timestamp.fromMillis(inicioMesMs(mes) - 2 * 864e5);
    equipe.forEach((m) => subs.push(onSnapshot(query(collection(db, "ponto", m.uid, "registros"), where("em", ">=", de), orderBy("em")),
      (s) => { reg[m.uid] = s.docs.map((d) => { const x = d.data({ serverTimestamps: "estimate" }); return { id: d.id, ...x, ms: x.em.toMillis() }; }); atualizar(); }, erro)));
  }
  assinar();
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
  const outras = [
    onSnapshot(collection(db, "ajustes_ponto"), (s) => { ajustes = ver(s); montar(); }, erro),
    onSnapshot(collection(db, "funcionarios"), (s) => { fichas = {}; s.docs.forEach((d) => { fichas[d.id] = d.data(); }); if (aba === "fichas") vFichas(); }, erro)
  ];
  const relogio = setInterval(() => { if (aba === "hoje") vHoje(); }, 60000);
  montar();
  return () => { clearInterval(relogio); subs.forEach((u) => u()); outras.forEach((u) => u()); };
}
