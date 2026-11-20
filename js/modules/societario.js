import { db, auth } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia, fmtData } from "../util.js";
import { resumo, carregarSocios, r2 } from "../core/financas.js";
import {
  collection, onSnapshot, addDoc, doc, runTransaction, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATUS = {
  pendente: ["Aguardando aprovação", ""],
  aprovado: ["Aprovado pelos dois", "warn"],
  pago: ["Pago", "ok"],
  recusado: ["Recusado", "bad"]
};
const ROTULO = { emprestimo: "Empréstimo à empresa", despesa: "Despesa paga do bolso", reembolso: "Reembolso recebido" };

export async function render(el, { perfil }) {
  const eu = auth.currentUser.uid;
  const socios = await carregarSocios();
  const nome = (id) => (socios.find((s) => s.uid === id) || {}).nome || "—";
  let lancs = [], reembs = [], cfg = {}, logs = [], aba = "conta";

  el.innerHTML = `<div id="raiz">
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <button class="btn-alt" data-aba="conta">Conta corrente</button>
      <button class="btn-alt" data-aba="reemb">Reembolsos</button>
      <button class="btn-alt" data-aba="hist">Histórico de alterações</button>
      <span class="flex-1"></span>
      <button id="novo" class="btn">Solicitar reembolso</button>
    </div>
    <div id="corpo"></div>
    <dialog id="dR"><form id="fR" class="space-y-3">
      <h2 class="h2">Solicitar reembolso</h2>
      <label>Sócio que vai receber<select name="socioId" class="input">${socios.map((s) => `<option value="${s.uid}" ${s.uid === eu ? "selected" : ""}>${esc(s.nome)}</option>`).join("")}</select></label>
      <label>Valor (R$)<input name="valor" required inputmode="decimal" class="input"></label>
      <label>Motivo<input name="motivo" required maxlength="200" class="input" placeholder="Ex.: devolução parcial do empréstimo"></label>
      <p class="text-xs text-off/60">Sua solicitação já conta como a sua aprovação. O outro sócio precisa aprovar separadamente, e o pagamento só é registrado se houver saldo em caixa.</p>
      <div class="flex gap-2 justify-end"><button type="button" id="cancelarR" class="btn-alt">Cancelar</button><button class="btn">Enviar solicitação</button></div>
    </form></dialog>
  </div>`;

  const raiz = el.querySelector("#raiz");
  const dR = raiz.querySelector("#dR"), fR = raiz.querySelector("#fR");
  const fin = () => resumo(lancs, cfg.caixaInicial || 0);

  function desenhar() {
    raiz.querySelectorAll("[data-aba]").forEach((b) => b.classList.toggle("on", b.dataset.aba === aba));
    raiz.querySelector("#novo").classList.toggle("hidden", aba !== "reemb");
    raiz.querySelector("#corpo").innerHTML = aba === "conta" ? vConta() : aba === "reemb" ? vReemb() : vHist();
  }

  function vConta() {
    const g = fin();
    return `<p class="mb-4 text-off/70">Saldo em caixa da empresa: <b>${brl(g.caixa)}</b></p>
      <div class="grid gap-4 lg:grid-cols-2">${socios.map((s) => {
        const x = g.soc[s.uid] || { emprestado: 0, despesasPagas: 0, reembolsado: 0, saldo: 0 };
        const mov = lancs.filter((l) => l.socioId === s.uid && ROTULO[l.tipo])
          .sort((a, b) => a.data.localeCompare(b.data) || (a.criadoEm?.seconds || 0) - (b.criadoEm?.seconds || 0));
        let acc = 0;
        const linhas = mov.map((l) => { acc = r2(acc + (l.tipo === "reembolso" ? -l.valor : l.valor)); return { l, acc }; }).reverse();
        return `<div class="card overflow-x-auto"><h2 class="h2">${esc(s.nome)}</h2>
          <p class="text-off/60 text-sm">Saldo que a empresa deve devolver (empréstimo sem juros)</p>
          <p class="text-3xl font-extrabold my-1">${brl(x.saldo)}</p>
          <p class="text-sm text-off/70 mb-3">Emprestou ${brl(x.emprestado)} · Despesas do bolso ${brl(x.despesasPagas)} · Reembolsado ${brl(x.reembolsado)}</p>
          <table><tr><th>Data</th><th>Movimento</th><th>Valor</th><th>Saldo</th></tr>
          ${linhas.map(({ l, acc: sd }) => `<tr><td>${fmtDia(l.data)}</td><td>${ROTULO[l.tipo]}<br><small class="text-off/60">${esc(l.descricao)}</small></td>
            <td style="color:${l.tipo === "reembolso" ? "#ffb067" : "#5fc08a"}">${l.tipo === "reembolso" ? "−" : "+"} ${brl(l.valor)}</td><td>${brl(sd)}</td></tr>`).join("") || '<tr><td colspan="4">Sem movimentos.</td></tr>'}
          </table></div>`;
      }).join("")}</div>`;
  }

  function vReemb() {
    if (!reembs.length) return `<div class="card">Nenhuma solicitação de reembolso ainda.</div>`;
    return [...reembs].sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0)).map((r) => {
      const [rot, cls] = STATUS[r.status] || [r.status, ""];
      const aprov = r.aprovacoes || {};
      const aberto = r.status === "pendente" || r.status === "aprovado";
      return `<div class="card mb-3">
        <div class="flex items-center gap-2"><h3 class="h2 flex-1">${brl(r.valor)} para ${esc(r.socioNome)}</h3><span class="tag ${cls}">${rot}</span></div>
        <p class="my-1">${esc(r.motivo)}</p>
        <p class="text-xs text-off/60">Solicitado por ${esc(r.solicitadoPorNome)} em ${fmtData(r.criadoEm)}</p>
        <div class="flex flex-wrap gap-2 mt-2">${socios.map((s) => `<span class="tag ${aprov[s.uid] ? "ok" : ""}">${esc(s.nome)}: ${aprov[s.uid] ? "aprovou" : "pendente"}</span>`).join("")}</div>
        <div class="flex flex-wrap gap-2 mt-3">
          ${r.status === "pendente" && !aprov[eu] ? `<button class="btn" data-act="aprovar" data-id="${r.id}">Aprovar</button>` : ""}
          ${r.status === "aprovado" ? `<button class="btn" data-act="pagar" data-id="${r.id}">Registrar pagamento</button>` : ""}
          ${aberto ? `<button class="btn-alt" data-act="recusar" data-id="${r.id}">Recusar</button>` : ""}
        </div></div>`;
    }).join("");
  }

  function vHist() {
    return `<div class="card overflow-x-auto"><table><tr><th>Data e hora</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr>
      ${logs.map((l) => `<tr><td>${fmtData(l.em)}</td><td>${esc(l.nome)}</td><td>${esc(l.acao)}</td><td>${esc(l.detalhe)}</td></tr>`).join("") || '<tr><td colspan="4">Sem registros.</td></tr>'}
    </table></div><p class="text-xs text-off/50 mt-2">Últimos 100 registros. Ninguém consegue editar ou apagar este histórico.</p>`;
  }

  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]");
    if (ab) { aba = ab.dataset.aba; return desenhar(); }
    if (e.target.id === "novo") { fR.reset(); fR.elements.socioId.value = eu; return dR.showModal(); }
    if (e.target.id === "cancelarR") return dR.close();
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const r = reembs.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const ref = doc(db, "reembolsos", r.id);
    b.disabled = true;
    try {
      if (b.dataset.act === "aprovar") {
        await runTransaction(db, async (tx) => {
          const s = (await tx.get(ref)).data();
          if (s.status !== "pendente" || s.aprovacoes[eu]) throw new Error("JA_FEITO");
          const ap = { ...s.aprovacoes, [eu]: true };
          tx.update(ref, { aprovacoes: ap, status: Object.keys(ap).length >= 2 ? "aprovado" : "pendente" });
        });
        await auditar(perfil, "reembolso_aprovado", `${brl(r.valor)} para ${r.socioNome}`);
        toast("Aprovação registrada.");
      } else if (b.dataset.act === "recusar") {
        if (!confirm(`Recusar o reembolso de ${brl(r.valor)} para ${r.socioNome}?`)) return;
        await runTransaction(db, async (tx) => {
          const s = (await tx.get(ref)).data();
          if (!["pendente", "aprovado"].includes(s.status)) throw new Error("JA_FEITO");
          tx.update(ref, { status: "recusado", recusadoPor: eu });
        });
        await auditar(perfil, "reembolso_recusado", `${brl(r.valor)} para ${r.socioNome}`);
        toast("Solicitação recusada.");
      } else if (b.dataset.act === "pagar") {
        const g = fin(), saldo = (g.soc[r.socioId] || {}).saldo || 0;
        if (r.valor > g.caixa) return toast(`Caixa insuficiente: há ${brl(g.caixa)} disponíveis.`);
        if (r.valor > saldo) return toast(`Maior que o saldo a devolver a ${r.socioNome} (${brl(saldo)}).`);
        if (!confirm(`Confirmar o pagamento de ${brl(r.valor)} para ${r.socioNome}? O saldo dele só diminui agora.`)) return;
        await runTransaction(db, async (tx) => {
          const s = (await tx.get(ref)).data();
          if (s.status !== "aprovado") throw new Error("JA_FEITO");
          tx.update(ref, { status: "pago", pagoEm: serverTimestamp(), pagoPor: eu });
          tx.set(doc(db, "lancamentos", "reemb_" + r.id), {
            tipo: "reembolso", data: hojeISO(), descricao: `Reembolso a ${r.socioNome}: ${r.motivo}`, categoria: "Reembolso a sócio",
            valor: r.valor, socioId: r.socioId, socioNome: r.socioNome, canal: "", comprovante: "", obs: "", reembolsoId: r.id,
            criadoPor: eu, criadoPorNome: perfil.nome, criadoEm: serverTimestamp()
          });
        });
        await auditar(perfil, "reembolso_pago", `${brl(r.valor)} para ${r.socioNome}`);
        toast("Pagamento registrado.");
      }
    } catch (err) {
      console.error(err);
      toast(err.message === "JA_FEITO" ? "Esta solicitação já foi atualizada. Confira o status." : traduzErro(err));
    } finally { b.disabled = false; }
  });

  fR.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(fR));
    const valor = parseBRL(d.valor);
    if (!(valor > 0)) return toast("Informe um valor válido.");
    const saldo = (fin().soc[d.socioId] || {}).saldo || 0;
    if (valor > saldo) return toast(`Maior que o saldo a devolver a ${nome(d.socioId)} (${brl(saldo)}).`);
    try {
      await addDoc(collection(db, "reembolsos"), {
        socioId: d.socioId, socioNome: nome(d.socioId), valor: r2(valor), motivo: d.motivo.trim(), status: "pendente",
        aprovacoes: { [eu]: true }, solicitadoPor: eu, solicitadoPorNome: perfil.nome, criadoEm: serverTimestamp()
      });
      await auditar(perfil, "reembolso_solicitado", `${brl(valor)} para ${nome(d.socioId)}: ${d.motivo.trim()}`);
      dR.close();
      toast("Solicitação enviada.");
    } catch (err) { console.error(err); toast(traduzErro(err)); }
  });

  const erro = (e) => { console.error(e); toast(traduzErro(e)); };
  const paradas = [
    onSnapshot(collection(db, "lancamentos"), (s) => { lancs = s.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); }, erro),
    onSnapshot(collection(db, "reembolsos"), (s) => { reembs = s.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); }, erro),
    onSnapshot(doc(db, "config", "geral"), (s) => { cfg = s.exists() ? s.data() : {}; desenhar(); }, erro),
    onSnapshot(query(collection(db, "auditoria"), orderBy("em", "desc"), limit(100)), (s) => { logs = s.docs.map((d) => d.data()); desenhar(); }, erro)
  ];
  desenhar();
  return () => paradas.forEach((p) => p());
}
