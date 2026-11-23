import { db } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, hojeISO, fmtDia, brl, parseBRL } from "../util.js";
import { carregarUsuariosAtivos, carregarEquipe } from "../core/equipe.js";
import { DIAS, statusRotina, paraMim, progresso, execId, descreverRecorrencia, somaDias } from "../core/rotinas.js";
import { tirarEEnviar, MSG_FOTO, driveConfigurado } from "../core/foto.js";
import { baixarPEPS, parseQtd } from "../core/estoque.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, getDocs, runTransaction, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(MSG_FOTO[e.message] || traduzErro(e)); };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }) : "");
const TIPOS_PREJ = ["Perda de alimento", "Quebra de equipamento ou utensílio", "Erro de produção", "Devolução ou reclamação de cliente", "Dinheiro (troco, falta ou furto)", "Outro"];
const MODELOS = {
  abertura: { nome: "Abertura da loja", tipo: "diaria", itens: ["Ligar chapa, fritadeira e exaustor", "Conferir a limpeza das bancadas", "Conferir a temperatura das geladeiras", "Separar e conferir os preparos do dia"] },
  fechamento: { nome: "Fechamento da loja", tipo: "diaria", itens: ["Desligar chapa e fritadeira", "Limpar chapa e coifa", "Guardar os preparos etiquetados na geladeira", "Retirar o lixo", "Conferir portas e janelas"] },
  auditoria: { nome: "Auditoria de estoque (a cada 15 dias)", tipo: "intervalo", cada: 15, itens: ["[foto] Foto das geladeiras e do congelador", "[foto] Foto do estoque seco (prateleiras)", "Conferir as validades e separar o que vence em até 7 dias", "Fazer a contagem no sistema (Estoque > Contagem)"] }
};

export async function render(el, { perfil }) {
  const uid = perfil.uid, admin = perfil.papel === "admin", operacional = admin || perfil.papel === "gerente", hoje = hojeISO();
  const [pessoas, equipe] = await Promise.all([admin ? carregarUsuariosAtivos() : [], operacional ? carregarEquipe(perfil) : []]);
  let aba = admin ? "hoje" : "dia", rotinas = [], execs = {}, ultimas = {}, prej = [], insumos = [], histor = [], editando = null, fotoPrej = null;
  const ABAS = [...(!admin ? [["dia", "Meu dia"]] : []), ...(operacional ? [["hoje", "Acompanhamento"]] : []), ...(admin ? [["cad", "Rotinas"]] : []), ["prej", "Prejuízos"], ...(admin ? [["hist", "Histórico"]] : [])];

  el.innerHTML = `<div id="raiz"><div id="abas" class="flex flex-wrap gap-3 mb-5"></div><div id="acoes" class="flex flex-wrap gap-3 mb-5"></div><div id="corpo"></div>
    <dialog id="dR"><form id="fR" class="space-y-4"><h2 class="h2" id="tR"></h2>
      <label>Começar de um modelo<select id="modelo" class="input"><option value="">— escolher —</option>${Object.entries(MODELOS).map(([k, m]) => `<option value="${k}">${m.nome}</option>`).join("")}</select></label>
      <label>Nome da rotina<input name="nome" required maxlength="120" class="input"></label>
      <label>Quando<select name="tipo" class="input"><option value="diaria">Todos os dias</option><option value="semanal">Em dias da semana</option><option value="mensal">Uma vez por mês</option><option value="intervalo">A cada N dias</option></select></label>
      <div data-rec="semanal" class="flex flex-wrap gap-3">${DIAS.map((d, i) => `<label class="flex items-center gap-2" style="font-size:1rem;color:inherit"><input type="checkbox" name="dia" value="${i}"> ${d}</label>`).join("")}</div>
      <label data-rec="mensal">Dia do mês (1 a 28)<input name="diaMes" type="number" min="1" max="28" class="input" value="1"></label>
      <label data-rec="intervalo">Repetir a cada quantos dias<input name="cada" type="number" min="1" max="365" class="input" value="15"></label>
      <label>Começa em<input name="inicio" type="date" class="input"></label>
      <fieldset><legend class="text-sm font-semibold text-ink/70 mb-2">Para quem</legend><div class="grid gap-2">
        <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="papel" value="funcionario"> Todos os funcionários</label>
        <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="papel" value="gerente"> Gerente</label>
        ${pessoas.filter((p) => p.papel !== "admin").map((p) => `<label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="uid" value="${p.uid}"> ${esc(p.nome)}</label>`).join("")}</div></fieldset>
      <label>Itens do checklist (um por linha)<textarea name="itens" rows="6" class="input" placeholder="Conferir validades&#10;[foto] Foto da geladeira"></textarea></label>
      <p class="text-xs text-ink/70">Comece a linha com <b>[foto]</b> para exigir uma foto (com data e hora) ao marcar o item.</p>
      <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="ativo" checked> Rotina ativa</label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dR" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog>
    <dialog id="dP"><form id="fP" class="space-y-4"><h2 class="h2">Reportar prejuízo</h2>
      <label>O que aconteceu<select name="tipo" class="input">${TIPOS_PREJ.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label>Descreva<textarea name="descricao" required rows="3" maxlength="300" class="input" placeholder="Ex.: derrubei uma bandeja de blend no chão"></textarea></label>
      <label>Insumo envolvido (opcional)<select name="insumo" class="input"></select></label>
      <label>Quantidade perdida<input name="qtd" class="input" inputmode="decimal" placeholder="Ex.: 500 ou 1,5 kg"></label>
      <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="baixa" checked> Dar baixa no estoque como descarte</label>
      <div><button type="button" class="btn-alt" data-foto="prej">Anexar foto</button> <span id="fotoPrej" class="text-sm"></span></div>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dP" class="btn-alt">Cancelar</button><button class="btn">Enviar relato</button></div></form></dialog></div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo"), dR = raiz.querySelector("#dR"), fR = raiz.querySelector("#fR"), dP = raiz.querySelector("#dP"), fP = raiz.querySelector("#fP");

  const minhas = () => rotinas.filter((r) => paraMim(r, perfil));
  const dueHoje = (r) => statusRotina(r, hoje, ultimas[r.id] || null);
  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    raiz.querySelector("#acoes").innerHTML = aba === "cad" ? '<button class="btn" data-act="novaRot">Nova rotina</button>' : "";
    atualizar();
  }
  const atualizar = () => ({ dia: vDia, hoje: vHoje, cad: vCad, prej: vPrej, hist: vHist }[aba])();

  // ===== Meu dia =====
  function cartaoRotina(r, mostrarQuem = false) {
    const st = dueHoje(r), ex = execs[execId(r.id, hoje)], itens = ex?.itens || r.itens.map((i) => ({ ...i, feito: false })), p = progresso(itens);
    return `<div class="card mb-4"><div class="flex flex-wrap items-center gap-3"><h3 class="h2 flex-1">${esc(r.nome)}</h3>
        ${st.atrasada ? `<span class="tag bad">Atrasada ${st.diasAtraso} dia(s)</span>` : ""}${ex?.concluida ? '<span class="tag ok">Concluída</span>' : ""}<span class="tag">${descreverRecorrencia(r.recorrencia)}</span></div>
      <div class="h-3 rounded-full bg-ink/10 overflow-hidden my-3"><div class="h-full bg-brand" style="width:${p.total ? (p.feitos / p.total) * 100 : 0}%"></div></div>
      <p class="text-sm text-ink/70 mb-2">${p.feitos} de ${p.total} itens${ex?.concluida ? ` · concluída por ${esc(ex.concluidaPor)} às ${hhmm(ex.concluidaEm)}` : ""}</p>
      ${itens.map((i, k) => `<div class="flex items-start gap-3 py-2 border-b border-ink/10"><button class="btn-alt" style="min-width:48px;min-height:48px;${i.feito ? "background:#14532d;color:#fff;border-color:#14532d" : ""}" data-act="item" data-r="${r.id}" data-k="${k}" aria-label="Marcar item">${i.feito ? "✔" : ""}</button>
        <div class="flex-1"><span style="${i.feito ? "text-decoration:line-through;opacity:.6" : ""}">${esc(i.texto)}</span>${i.exigeFoto ? ' <span class="tag">foto</span>' : ""}
        ${i.feito ? `<br><small class="text-ink/70">${esc(i.porNome || "")} às ${hhmm(i.em)}${i.foto ? ` · <a class="underline text-brand-dark" href="${esc(i.foto)}" target="_blank" rel="noopener">ver foto</a>` : ""}</small>` : ""}</div></div>`).join("")}</div>`;
  }
  function vDia() {
    const lista = minhas().filter((r) => dueHoje(r).devida || execs[execId(r.id, hoje)]).sort((a, b) => (dueHoje(b).atrasada ? 1 : 0) - (dueHoje(a).atrasada ? 1 : 0));
    const meuPrej = prej.filter((x) => x.reportadoPor === uid && x.data === hoje), disse = meuPrej.length > 0;
    corpo.innerHTML = `<h3 class="h2 mb-3">Checklist de hoje · ${fmtDia(hoje)}</h3>${lista.map((r) => cartaoRotina(r)).join("") || '<div class="card mb-4">Nenhuma rotina para você hoje.</div>'}
      <h3 class="h2 mb-3 mt-6">Prejuízos do dia</h3><div class="card"><p class="mb-3">${disse ? '<span class="foto-ok">✔ Você já informou o dia de hoje.</span>' : "Teve algum prejuízo hoje (perda de comida, quebra, erro, devolução)? Conte aqui. Se não teve, avise também."}</p>
        <div class="flex flex-wrap gap-3"><button class="btn" data-act="novoPrej">Reportar prejuízo</button>${disse ? "" : '<button class="btn-alt" data-act="semPrej">Hoje não houve prejuízo</button>'}</div></div>`;
  }

  async function marcar(r, k) {
    const ref = doc(db, "rotinas_exec", execId(r.id, hoje)), atual = execs[execId(r.id, hoje)]?.itens?.[k] || r.itens[k], feito = !atual.feito;
    let foto = "";
    if (feito && atual.exigeFoto) {
      if (!driveConfigurado()) { if (!confirm("O envio de fotos ainda não foi configurado. Marcar este item sem foto?")) return; }
      else { toast("Abrindo a câmera…"); const f = await tirarEEnviar({ pasta: "Rotinas", nome: `${r.nome}_item${k + 1}`, carimbo: true, texto: `${perfil.nome} · ${r.nome}` }); if (!f) return; foto = f.url; }
    }
    await runTransaction(db, async (tx) => {
      const s = await tx.get(ref), base = s.exists() ? s.data() : { rotinaId: r.id, data: hoje, nome: r.nome, itens: r.itens.map((i) => ({ texto: i.texto, exigeFoto: !!i.exigeFoto, feito: false })) };
      const itens = base.itens.map((i, n) => (n === k ? { ...i, feito, por: feito ? uid : "", porNome: feito ? perfil.nome : "", em: feito ? new Date().toISOString() : "", foto: feito ? foto : "" } : i));
      const todos = itens.every((i) => i.feito);
      tx.set(ref, { ...base, itens, concluida: todos, concluidaPor: todos ? perfil.nome : "", concluidaEm: todos ? new Date().toISOString() : "", atualizadoEm: serverTimestamp() });
    });
    if (feito && progresso(execs[execId(r.id, hoje)]?.itens || []).feitos + 1 === r.itens.length) toast("Rotina concluída. Bom trabalho!");
  }

  // ===== Acompanhamento (sócios e gerente) =====
  function vHoje() {
    const lista = rotinas.filter((r) => r.ativo !== false && (dueHoje(r).devida || execs[execId(r.id, hoje)]));
    corpo.innerHTML = `<h3 class="h2 mb-3">Situação de hoje · ${fmtDia(hoje)}</h3>` + (lista.length ? `<div class="card"><table><tr><th>Rotina</th><th>Situação</th><th>Quem</th></tr>
      ${lista.map((r) => { const ex = execs[execId(r.id, hoje)], p = progresso(ex?.itens || r.itens), st = dueHoje(r);
        const sit = ex?.concluida ? '<span class="tag ok">Concluída</span>' : ex ? `<span class="tag">${p.feitos} de ${p.total}</span>` : `<span class="tag bad">Não iniciada</span>`;
        return `<tr><td><b>${esc(r.nome)}</b>${st.atrasada ? `<br><small style="color:#8a1d10">atrasada ${st.diasAtraso} dia(s)</small>` : ""}</td><td>${sit}</td><td>${esc(ex?.concluidaPor || [...new Set((ex?.itens || []).map((i) => i.porNome).filter(Boolean))].join(", ") || "—")}</td></tr>`; }).join("")}</table></div>`
      : '<div class="card">Nenhuma rotina prevista para hoje.</div>');
  }

  // ===== Cadastro das rotinas (sócios) =====
  function vCad() {
    corpo.innerHTML = rotinas.length ? [...rotinas].sort((a, b) => a.nome.localeCompare(b.nome)).map((r) => `<div class="card mb-4"><div class="flex flex-wrap items-center gap-3"><h3 class="h2 flex-1">${esc(r.nome)}</h3>${r.ativo === false ? '<span class="tag">Inativa</span>' : ""}<span class="tag">${descreverRecorrencia(r.recorrencia)}</span></div>
      <p class="text-sm text-ink/70 mt-2">Para: ${[...(r.paraPapeis || []).map((p) => (p === "funcionario" ? "todos os funcionários" : "gerente")), ...(r.paraUids || []).map((id) => pessoas.find((x) => x.uid === id)?.nome || "")].filter(Boolean).join(", ") || "ninguém"} · ${r.itens.length} itens</p>
      <ul class="list-disc pl-6 mt-2 text-sm">${r.itens.map((i) => `<li>${esc(i.texto)}${i.exigeFoto ? " 📷" : ""}</li>`).join("")}</ul>
      <div class="flex gap-3 mt-4"><button class="btn-alt" data-act="editRot" data-id="${r.id}">Editar</button><button class="btn-alt" data-act="delRot" data-id="${r.id}">Excluir</button></div></div>`).join("")
      : '<div class="card">Nenhuma rotina ainda. Toque em "Nova rotina". Dica: comece pelos modelos (abertura, fechamento e auditoria de estoque a cada 15 dias).</div>';
  }
  function ajustaRec() { const t = fR.elements.tipo.value; fR.querySelectorAll("[data-rec]").forEach((e) => e.classList.toggle("hidden", e.dataset.rec !== t)); }
  function abrirRot(r) {
    editando = r || null; fR.reset(); raiz.querySelector("#tR").textContent = r ? "Editar rotina" : "Nova rotina";
    const x = fR.elements; x.inicio.value = hoje;
    if (r) {
      x.nome.value = r.nome; x.tipo.value = r.recorrencia?.tipo || "diaria"; x.diaMes.value = r.recorrencia?.diaMes || 1; x.cada.value = r.recorrencia?.cada || 15; x.inicio.value = r.recorrencia?.inicio || hoje;
      fR.querySelectorAll('[name="dia"]').forEach((c) => { c.checked = (r.recorrencia?.dias || []).includes(Number(c.value)); });
      fR.querySelectorAll('[name="papel"]').forEach((c) => { c.checked = (r.paraPapeis || []).includes(c.value); });
      fR.querySelectorAll('[name="uid"]').forEach((c) => { c.checked = (r.paraUids || []).includes(c.value); });
      x.itens.value = r.itens.map((i) => (i.exigeFoto ? "[foto] " : "") + i.texto).join("\n"); x.ativo.checked = r.ativo !== false;
    }
    ajustaRec(); dR.showModal();
  }
  async function salvarRot() {
    const d = Object.fromEntries(new FormData(fR));
    const itens = d.itens.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50).map((s) => ({ texto: s.replace(/^\[foto\]\s*/i, ""), exigeFoto: /^\[foto\]/i.test(s) }));
    const paraPapeis = [...fR.querySelectorAll('[name="papel"]:checked')].map((c) => c.value), paraUids = [...fR.querySelectorAll('[name="uid"]:checked')].map((c) => c.value);
    const dias = [...fR.querySelectorAll('[name="dia"]:checked')].map((c) => Number(c.value));
    if (!itens.length) return toast("Escreva ao menos um item.");
    if (!paraPapeis.length && !paraUids.length) return toast("Escolha para quem é a rotina.");
    if (d.tipo === "semanal" && !dias.length) return toast("Escolha os dias da semana.");
    const dados = { nome: d.nome.trim(), recorrencia: { tipo: d.tipo, dias, diaMes: Math.min(28, Math.max(1, Number(d.diaMes) || 1)), cada: Math.min(365, Math.max(1, Number(d.cada) || 15)), inicio: d.inicio || hoje },
      paraPapeis, paraUids, itens, ativo: !!d.ativo, atualizadoEm: serverTimestamp() };
    if (editando) await updateDoc(doc(db, "rotinas", editando.id), dados); else await addDoc(collection(db, "rotinas"), { ...dados, criadoEm: serverTimestamp() });
    await auditar(perfil, editando ? "rotina_editada" : "rotina_criada", dados.nome);
    dR.close(); toast("Rotina salva.");
  }

  // ===== Prejuízos =====
  function vPrej() {
    const mes = hoje.slice(0, 7), lista = [...prej].filter((x) => !x.sem).sort((a, b) => b.data.localeCompare(a.data));
    const respondeu = new Set(prej.filter((x) => x.data === hoje).map((x) => x.reportadoPor)), faltam = equipe.filter((m) => !respondeu.has(m.uid));
    const totalMes = lista.filter((x) => x.data.startsWith(mes) && x.valor > 0).reduce((s, x) => s + x.valor, 0);
    if (!operacional) { corpo.innerHTML = `<div class="card mb-4"><div class="flex gap-3 flex-wrap"><button class="btn" data-act="novoPrej">Reportar prejuízo</button><button class="btn-alt" data-act="semPrej">Hoje não houve prejuízo</button></div></div>
      ${lista.filter((x) => x.reportadoPor === uid).length ? `<div class="card"><table><tr><th>Dia</th><th>O que</th></tr>${lista.filter((x) => x.reportadoPor === uid).map((x) => `<tr><td>${fmtDia(x.data)}</td><td>${esc(x.tipo)}<br><small class="text-ink/70">${esc(x.descricao)}</small></td></tr>`).join("")}</table></div>` : ""}`; return; }
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-2 mb-5"><div class="card"><div class="text-ink/70 text-sm">Relatos no mês</div><div class="num">${lista.filter((x) => x.data.startsWith(mes)).length}</div></div>
      ${admin ? `<div class="card"><div class="text-ink/70 text-sm">Valor dos prejuízos no mês</div><div class="num">${brl(totalMes)}</div></div>` : ""}</div>
      ${faltam.length ? `<p class="mb-4 text-sm"><span class="tag bad">Ainda não responderam hoje</span> ${faltam.map((m) => esc(m.nome)).join(", ")}</p>` : ""}
      ${lista.length ? `<div class="card"><table><tr><th>Dia</th><th>Quem</th><th>O que</th>${admin ? "<th>Valor</th>" : ""}<th></th></tr>${lista.slice(0, 100).map((x) => `<tr><td>${fmtDia(x.data)}</td><td>${esc(x.reportadoPorNome)}</td>
        <td><b>${esc(x.tipo)}</b><br><small class="text-ink/70">${esc(x.descricao)}</small>${x.insumoNome ? `<br><small>${esc(x.insumoNome)} · ${esc(x.qtdTexto || "")}${x.baixaRegistrada ? " (baixa feita)" : ""}</small>` : ""}${x.foto ? ` <a class="underline text-brand-dark text-sm" href="${esc(x.foto)}" target="_blank" rel="noopener">foto</a>` : ""}</td>
        ${admin ? `<td>${x.valor > 0 ? brl(x.valor) : "—"} <button class="btn-alt" data-act="valorPrej" data-id="${x.id}">Valor</button></td>` : ""}
        <td>${x.status === "visto" ? '<span class="tag ok">Visto</span>' : `<button class="btn-alt" data-act="vistoPrej" data-id="${x.id}">Marcar visto</button>`}</td></tr>`).join("")}</table></div>` : '<div class="card">Nenhum prejuízo reportado.</div>'}`;
  }
  function abrirPrej() {
    fP.reset(); fotoPrej = null; raiz.querySelector("#fotoPrej").textContent = "";
    fP.elements.insumo.innerHTML = '<option value="">Nenhum</option>' + [...insumos].filter((i) => i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)).map((i) => `<option value="${i.id}">${esc(i.nome)} (${i.unidade})</option>`).join("");
    dP.showModal();
  }
  async function enviarPrej() {
    const d = Object.fromEntries(new FormData(fP)), ins = insumos.find((i) => i.id === d.insumo);
    let baixa = false, qtdTexto = "", qtdVal = 0;
    if (ins && d.qtd.trim()) { const q = parseQtd(d.qtd, ins.unidade); if (q.erro) return toast(q.erro); qtdVal = q.valor; qtdTexto = `${String(q.valor).replace(".", ",")} ${ins.unidade}`; }
    if (ins && qtdVal && d.baixa) {
      try {
        const lotes = (await getDocs(query(collection(db, "lotes"), where("insumoId", "==", ins.id)))).docs.map((x) => ({ id: x.id, ...x.data() })).filter((l) => l.qtdAtual > 0);
        await baixarPEPS({ insumo: ins, qtd: qtdVal, tipo: "descarte", motivo: "descarte", obs: `Prejuízo reportado: ${d.tipo}`, perfil, lotes }); baixa = true;
      } catch (e) { toast("Não foi possível dar baixa no estoque (sem saldo?). O relato será enviado mesmo assim."); }
    }
    await addDoc(collection(db, "prejuizos"), { data: hoje, tipo: d.tipo, descricao: d.descricao.trim(), sem: false, insumoId: ins?.id || "", insumoNome: ins?.nome || "", qtdTexto, baixaRegistrada: baixa,
      foto: fotoPrej || "", valor: null, status: "novo", reportadoPor: uid, reportadoPorNome: perfil.nome, criadoEm: serverTimestamp() });
    await auditar(perfil, "prejuizo_reportado", `${d.tipo}: ${d.descricao.trim().slice(0, 80)}`);
    dP.close(); toast("Relato enviado. Obrigado por avisar.");
  }

  // ===== Histórico (sócios) =====
  async function carregarHist() {
    const s = await getDocs(query(collection(db, "rotinas_exec"), where("data", ">=", somaDias(hoje, -30)), orderBy("data", "desc"), limit(200)));
    histor = s.docs.map((d) => ({ id: d.id, ...d.data() })); vHist();
  }
  function vHist() {
    corpo.innerHTML = histor.length ? `<div class="card"><table><tr><th>Dia</th><th>Rotina</th><th>Itens</th><th>Concluída por</th><th>Fotos</th></tr>
      ${histor.map((h) => { const p = progresso(h.itens), fotos = (h.itens || []).filter((i) => i.foto);
        return `<tr><td>${fmtDia(h.data)}</td><td>${esc(h.nome)}</td><td>${h.concluida ? '<span class="tag ok">completa</span>' : `<span class="tag bad">${p.feitos} de ${p.total}</span>`}</td><td>${esc(h.concluidaPor || "—")}</td>
          <td>${fotos.map((i, n) => `<a class="underline text-brand-dark" href="${esc(i.foto)}" target="_blank" rel="noopener">foto ${n + 1}</a>`).join(" ") || "—"}</td></tr>`; }).join("")}</table></div><p class="text-xs text-ink/70 mt-2">Últimos 30 dias.</p>`
      : '<div class="card">Sem execuções nos últimos 30 dias.</div>';
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; montar(); if (aba === "hist") carregarHist().catch(erro); return; }
    const fc = e.target.closest("[data-fechar]");
    if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const fb = e.target.closest("[data-foto]");   // foto do prejuízo: chamada direta, sem await antes (exigência do celular)
    if (fb) {
      try { const f = await tirarEEnviar({ pasta: "Prejuizos", nome: `${perfil.nome}_prejuizo`, carimbo: true, texto: `${perfil.nome} · prejuízo` }); if (f) { fotoPrej = f.url; raiz.querySelector("#fotoPrej").innerHTML = '<span class="foto-ok">✔ foto anexada</span>'; } }
      catch (err) { erro(err); }
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "item") {   // marcar item: pode abrir a câmera, então não bloqueia o botão antes
      try { await marcar(rotinas.find((x) => x.id === b.dataset.r), Number(b.dataset.k)); } catch (err) { erro(err); }
      return;
    }
    b.disabled = true;
    try {
      const r = rotinas.find((x) => x.id === b.dataset.id), p = prej.find((x) => x.id === b.dataset.id);
      if (a === "novaRot") abrirRot(null);
      else if (a === "editRot") abrirRot(r);
      else if (a === "delRot" && confirm(`Excluir a rotina "${r.nome}"?`)) { await deleteDoc(doc(db, "rotinas", r.id)); await auditar(perfil, "rotina_excluida", r.nome); }
      else if (a === "novoPrej") abrirPrej();
      else if (a === "semPrej") { await setDoc(doc(db, "prejuizos", `sem_${uid}_${hoje}`), { data: hoje, tipo: "Sem prejuízo", descricao: "Informou que não houve prejuízo", sem: true, status: "visto", reportadoPor: uid, reportadoPorNome: perfil.nome, criadoEm: serverTimestamp() }); toast("Registrado: hoje não houve prejuízo."); }
      else if (a === "vistoPrej") await updateDoc(doc(db, "prejuizos", p.id), { status: "visto", vistoPor: uid, vistoPorNome: perfil.nome });
      else if (a === "valorPrej") { const v = prompt("Valor do prejuízo em R$ (deixe em branco para limpar):", p.valor ? String(p.valor).replace(".", ",") : ""); if (v !== null) { const n = v.trim() ? parseBRL(v) : null; if (n !== null && (isNaN(n) || n < 0)) toast("Valor inválido."); else await updateDoc(doc(db, "prejuizos", p.id), { valor: n }); } }
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });
  raiz.addEventListener("change", (e) => {
    if (e.target.name === "tipo" && e.target.closest("#fR")) ajustaRec();
    if (e.target.id === "modelo" && e.target.value) {
      const m = MODELOS[e.target.value], x = fR.elements; x.nome.value = m.nome; x.tipo.value = m.tipo; if (m.cada) x.cada.value = m.cada; x.itens.value = m.itens.join("\n"); ajustaRec();
    }
  });
  raiz.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn"); btn.disabled = true;
    try { if (e.target.id === "fR") await salvarRot(); else if (e.target.id === "fP") await enviarPrej(); } catch (err) { erro(err); } finally { btn.disabled = false; }
  });

  // ---------- dados em tempo real ----------
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const paradas = [
    onSnapshot(query(collection(db, "rotinas_exec"), where("data", "==", hoje)), (s) => { execs = {}; ver(s).forEach((x) => { execs[x.id] = x; }); atualizar(); }, erro),
    onSnapshot(collection(db, "insumos"), (s) => { insumos = ver(s); }, erro)
  ];
  const assinaIntervalos = () => {   // "a cada N dias": precisa saber quando foi a última conclusão
    rotinas.filter((r) => r.recorrencia?.tipo === "intervalo" && !ultimas["__s" + r.id]).forEach((r) => {
      ultimas["__s" + r.id] = true;
      paradas.push(onSnapshot(query(collection(db, "rotinas_exec"), where("rotinaId", "==", r.id)), (s) => {
        ultimas[r.id] = ver(s).filter((x) => x.concluida).map((x) => x.data).sort().pop() || null; atualizar();
      }, erro));
    });
  };
  paradas.push(onSnapshot(collection(db, "rotinas"), (s) => { rotinas = ver(s); assinaIntervalos(); atualizar(); }, erro));
  paradas.push(onSnapshot(operacional ? query(collection(db, "prejuizos"), orderBy("data", "desc"), limit(300)) : query(collection(db, "prejuizos"), where("reportadoPor", "==", uid)),
    (s) => { prej = ver(s); if (aba === "prej" || aba === "dia") atualizar(); }, erro));
  const virada = setInterval(() => { if (hojeISO() !== hoje) location.reload(); }, 60000);   // passou da meia-noite: recarrega o dia
  montar();
  return () => { clearInterval(virada); paradas.forEach((p) => p()); };
}
