import { db, auth } from "../firebase.js";
import { traduzErro } from "../auth.js";
import { esc, toast, auditar, brl, parseBRL, hojeISO, fmtDia } from "../util.js";
import { carregarSocios } from "../core/financas.js";
import { listarFaturas, faturaFechada, adicionarMeses, dividirParcelas, mesMais } from "../core/caixa.js";
import { entreDias } from "../core/rotinas.js";
import { tirarEEnviar, MSG_FOTO } from "../core/foto.js";
import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const erro = (e) => { console.error(e); toast(MSG_FOTO[e.message] || traduzErro(e)); };
const num = (n) => String(n ?? "").replace(".", ",");
const csvCel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export const FORMAS_PAG = { dinheiro: "Dinheiro", pix: "PIX", debito: "Débito", boleto: "Boleto", transferencia: "Transferência", outra: "Outra" };
const nomeMes = (ym) => new Date(Date.parse(ym + "-15T12:00:00Z")).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });

export async function render(el, { perfil }) {
  const uid = auth.currentUser.uid, hoje = hojeISO(), socios = await carregarSocios();
  let contas = [], lancs = [], cartoes = [], faturasPagas = [], cats = [], aba = "apagar", filtro = "abertas", editando = null, mesRef = hoje.slice(0, 7);
  const ABAS = [["apagar", "A pagar"], ["cartao", "Cartão da empresa"], ["forma", "Gastos por pagamento"]];
  const cartoesAtivos = () => cartoes.filter((c) => c.ativo !== false);

  el.innerHTML = `<div id="raiz"><div id="abas" class="flex flex-wrap gap-3 mb-5"></div><div id="acoes" class="flex flex-wrap gap-3 mb-5"></div><div id="corpo"></div>
    <dialog id="dC"><form id="fC" class="space-y-4"><h2 class="h2" id="tC"></h2>
      <label>Descrição<input name="descricao" required maxlength="160" class="input" placeholder="Ex.: Conta de energia, aluguel, fornecedor..."></label>
      <div class="grid grid-cols-2 gap-4"><label>Fornecedor<input name="fornecedor" maxlength="80" class="input"></label><label>Categoria<select name="categoria" class="input"></select></label>
        <label>Valor (R$)<input name="valor" required inputmode="decimal" class="input"></label><label>Vencimento<input name="vencimento" type="date" required class="input"></label></div>
      <div data-nova class="grid grid-cols-2 gap-4"><label>Repetição<select name="rep" class="input"><option value="unica">Conta única</option><option value="mensal">Repetir todo mês</option><option value="parcelada">Parcelar o valor</option></select></label>
        <label data-rep>Quantas vezes<input name="n" type="number" min="2" max="60" value="12" class="input"></label></div>
      <p data-rep class="text-xs text-ink/70">"Repetir todo mês" cria uma conta por mês com o mesmo valor (você ajusta o valor de cada uma quando a conta chegar). "Parcelar" divide o valor total entre as parcelas.</p>
      <label>Boleto (link) <input name="boleto" class="input" placeholder="https://... ou use a foto abaixo"></label>
      <div><button type="button" class="btn-alt" data-foto="boleto">Foto do boleto</button> <span id="fotoMsg" class="text-sm"></span></div>
      <label>Observações<input name="obs" maxlength="200" class="input"></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dC" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog>
    <dialog id="dP"><form id="fP" class="space-y-4"><h2 class="h2">Pagar conta</h2><p id="pInfo" class="text-ink/70"></p>
      <div class="grid grid-cols-2 gap-4"><label>Pago em<input name="pagoEm" type="date" required class="input"></label><label>Valor pago (R$)<input name="valorPago" required inputmode="decimal" class="input"></label></div>
      <label>Quem pagou<select name="quem" class="input"></select></label>
      <label data-forma>Forma de pagamento<select name="forma" class="input">${Object.entries(FORMAS_PAG).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Comprovante (link, opcional)<input name="comprovante" class="input" placeholder="https://..."></label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dP" class="btn-alt">Cancelar</button><button class="btn">Confirmar pagamento</button></div></form></dialog>
    <dialog id="dK"><form id="fK" class="space-y-4"><h2 class="h2" id="tK"></h2>
      <label>Nome do cartão<input name="nome" required maxlength="60" class="input" placeholder="Ex.: Cartão da empresa"></label><label>Final do cartão (4 dígitos, opcional)<input name="final" maxlength="4" inputmode="numeric" class="input"></label>
      <div class="grid grid-cols-2 gap-4"><label>Dia do fechamento<input name="fech" type="number" min="1" max="31" required class="input"></label><label>Dia do vencimento<input name="venc" type="number" min="1" max="31" required class="input"></label></div>
      <label class="flex items-center gap-3" style="font-size:1rem;color:inherit"><input type="checkbox" name="ativo" checked> Cartão ativo</label>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dK" class="btn-alt">Cancelar</button><button class="btn">Salvar</button></div></form></dialog>
    <dialog id="dF"><form id="fF" class="space-y-4"><h2 class="h2">Pagar fatura</h2><p id="fInfo" class="text-ink/70"></p>
      <div class="grid grid-cols-2 gap-4"><label>Pago em<input name="pagoEm" type="date" required class="input"></label><label>Valor pago (R$)<input name="valorPago" required inputmode="decimal" class="input"></label></div>
      <p class="text-xs text-ink/70">O valor sai do caixa agora. As compras dessa fatura já estavam lançadas como despesas e não são contadas de novo.</p>
      <div class="flex gap-3 justify-end"><button type="button" data-fechar="dF" class="btn-alt">Cancelar</button><button class="btn">Confirmar pagamento</button></div></form></dialog>
    <dialog id="dX" style="max-width:42rem"></dialog></div>`;
  const raiz = el.querySelector("#raiz"), corpo = raiz.querySelector("#corpo");
  const dC = raiz.querySelector("#dC"), dP = raiz.querySelector("#dP"), dK = raiz.querySelector("#dK"), dF = raiz.querySelector("#dF"), dX = raiz.querySelector("#dX");
  const fC = raiz.querySelector("#fC"), fP = raiz.querySelector("#fP"), fK = raiz.querySelector("#fK"), fF = raiz.querySelector("#fF");
  let pagando = null, faturaPagando = null;

  function montar() {
    raiz.querySelector("#abas").innerHTML = ABAS.map(([k, l]) => `<button class="btn-alt ${aba === k ? "on" : ""}" data-aba="${k}">${l}</button>`).join("");
    raiz.querySelector("#acoes").innerHTML = aba === "apagar" ? '<button class="btn" data-act="novaConta">Nova conta</button>' : aba === "cartao" ? '<button class="btn" data-act="novoCartao">Novo cartão</button>' : "";
    atualizar();
  }
  const atualizar = () => ({ apagar: vPagar, cartao: vCartao, forma: vForma }[aba])();

  // ===================== A PAGAR =====================
  function vPagar() {
    const abertas = contas.filter((c) => c.status === "aberta"), venc = abertas.filter((c) => c.vencimento < hoje), sem7 = abertas.filter((c) => c.vencimento >= hoje && entreDias(hoje, c.vencimento) <= 7);
    const k = (t, v, d = "") => `<div class="card"><div class="text-ink/70 text-sm">${t}</div><div class="num mt-1">${v}</div>${d ? `<div class="text-xs text-ink/70 mt-1">${d}</div>` : ""}</div>`;
    const soma = (l) => l.reduce((s, c) => s + c.valor, 0);
    const lista = contas.filter((c) => filtro === "todas" || (filtro === "abertas" ? c.status === "aberta" : c.status === "paga")).sort((a, b) => (filtro === "pagas" ? b.vencimento.localeCompare(a.vencimento) : a.vencimento.localeCompare(b.vencimento)));
    corpo.innerHTML = `<div class="grid gap-4 sm:grid-cols-3 mb-5">${k("Vencidas", brl(soma(venc)), `${venc.length} conta(s)`)}${k("Vencem em 7 dias", brl(soma(sem7)), `${sem7.length} conta(s)`)}${k("Total em aberto", brl(soma(abertas)), `${abertas.length} conta(s)`)}</div>
      <div class="flex gap-3 mb-4">${[["abertas", "Em aberto"], ["pagas", "Pagas"], ["todas", "Todas"]].map(([f, l]) => `<button class="btn-alt ${filtro === f ? "on" : ""}" data-filtro="${f}">${l}</button>`).join("")}</div>
      ${lista.length ? lista.map((c) => {
        const d = entreDias(hoje, c.vencimento), tag = c.status === "paga" ? `<span class="tag ok">Paga em ${fmtDia(c.pagoEm)}</span>` : d < 0 ? `<span class="tag bad">Vencida há ${-d} dia(s)</span>` : d === 0 ? '<span class="tag" style="background:#ffb067">Vence hoje</span>' : d <= 3 ? `<span class="tag" style="background:#ffb067">Vence em ${d} dia(s)</span>` : `<span class="tag">Vence em ${fmtDia(c.vencimento)}</span>`;
        return `<div class="card mb-3 ${c.status === "aberta" && d < 0 ? "minha" : ""}"><div class="flex flex-wrap items-center gap-3"><h3 class="h2 flex-1">${esc(c.descricao)}${c.parcela ? ` <span class="text-ink/70">(${c.parcela.k}/${c.parcela.n})</span>` : ""}</h3><b class="num" style="font-size:1.6rem">${brl(c.status === "paga" ? c.valorPago : c.valor)}</b></div>
          <p class="text-sm text-ink/70 mt-1">${esc(c.fornecedor || "")}${c.categoria ? ` · ${esc(c.categoria)}` : ""} · vencimento ${fmtDia(c.vencimento)}${c.boleto ? ` · <a class="underline text-brand-dark" href="${esc(c.boleto)}" target="_blank" rel="noopener">boleto</a>` : ""}</p>
          <div class="flex flex-wrap items-center gap-3 mt-3">${tag}${c.status === "aberta" ? `<span class="flex-1"></span><button class="btn" data-act="pagar" data-id="${c.id}">Pagar</button><button class="btn-alt" data-act="editConta" data-id="${c.id}">Editar</button><button class="btn-alt" data-act="delConta" data-id="${c.id}">Excluir</button>` : ""}</div></div>`;
      }).join("") : '<div class="card">Nenhuma conta aqui. Toque em "Nova conta".</div>'}`;
  }

  function abrirConta(c) {
    editando = c || null; fC.reset(); raiz.querySelector("#tC").textContent = c ? "Editar conta" : "Nova conta a pagar";
    fC.elements.categoria.innerHTML = cats.map((x) => `<option>${esc(x)}</option>`).join("") + (cats.includes("Outros") ? "" : "<option>Outros</option>");
    fC.querySelector("[data-nova]").classList.toggle("hidden", !!c); fC.querySelectorAll("[data-rep]").forEach((e) => e.classList.add("hidden")); raiz.querySelector("#fotoMsg").textContent = "";
    if (c) { const x = fC.elements; x.descricao.value = c.descricao; x.fornecedor.value = c.fornecedor || ""; x.categoria.value = c.categoria || "Outros"; x.valor.value = num(c.valor); x.vencimento.value = c.vencimento; x.boleto.value = c.boleto || ""; x.obs.value = c.obs || ""; }
    else fC.elements.vencimento.value = hoje;
    dC.showModal();
  }
  async function salvarConta() {
    const d = Object.fromEntries(new FormData(fC)), valor = parseBRL(d.valor);
    if (!(valor > 0)) return toast("Informe um valor válido.");
    const boleto = (d.boleto || "").trim(); if (boleto && !/^https?:\/\//i.test(boleto)) return toast("O link do boleto deve começar com http:// ou https://");
    const base = { descricao: d.descricao.trim(), fornecedor: d.fornecedor.trim(), categoria: d.categoria, vencimento: d.vencimento, boleto, obs: d.obs.trim() };
    if (editando) { await updateDoc(doc(db, "contas", editando.id), { ...base, valor: Math.round(valor * 100) / 100, atualizadoEm: serverTimestamp() }); await auditar(perfil, "conta_editada", base.descricao); dC.close(); return toast("Conta salva."); }
    const n = d.rep === "unica" ? 1 : Math.round(Number(d.n)); if (!(n >= 1 && n <= 60)) return toast("Informe de 2 a 60 vezes.");
    const valores = d.rep === "parcelada" ? dividirParcelas(valor, n) : Array(n).fill(Math.round(valor * 100) / 100), serie = doc(collection(db, "contas")).id, lote = writeBatch(db);
    valores.forEach((v, i) => lote.set(doc(collection(db, "contas")), { ...base, valor: v, vencimento: adicionarMeses(d.vencimento, i), status: "aberta", ...(n > 1 ? { serie, parcela: { k: i + 1, n, tipo: d.rep } } : {}), criadoPor: uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp() }));
    await lote.commit(); await auditar(perfil, "conta_criada", `${base.descricao}${n > 1 ? ` (${n}x)` : ""}`); dC.close(); toast(n > 1 ? `${n} contas criadas.` : "Conta criada.");
  }

  function abrirPagar(c) {
    pagando = c; fP.reset(); const x = fP.elements;
    raiz.querySelector("#pInfo").textContent = `${c.descricao}${c.parcela ? ` (${c.parcela.k}/${c.parcela.n})` : ""} · vencimento ${fmtDia(c.vencimento)}`;
    x.pagoEm.value = hoje; x.valorPago.value = num(c.valor);
    x.quem.innerHTML = '<option value="caixa">Caixa da empresa</option>' + cartoesAtivos().map((k) => `<option value="cartao:${k.id}">${esc(k.nome)}</option>`).join("") + socios.map((s) => `<option value="socio:${s.uid}">${esc(s.nome)} (do bolso)</option>`).join("");
    ajustaForma(); dP.showModal();
  }
  const ajustaForma = () => fP.querySelector("[data-forma]").classList.toggle("hidden", fP.elements.quem.value.startsWith("cartao:"));
  async function confirmarPagamento() {
    const d = Object.fromEntries(new FormData(fP)), c = pagando, v = parseBRL(d.valorPago);
    if (!(v > 0)) return toast("Informe o valor pago.");
    const comp = (d.comprovante || "").trim(); if (comp && !/^https?:\/\//i.test(comp)) return toast("O link do comprovante deve começar com http:// ou https://");
    let socioId = "", socioNome = "", cartaoId = "", cartaoNome = "", forma = d.forma;
    if (d.quem.startsWith("cartao:")) { const k = cartoes.find((x) => x.id === d.quem.slice(7)); cartaoId = k.id; cartaoNome = k.nome; forma = "cartao"; }
    else if (d.quem.startsWith("socio:")) { socioId = d.quem.slice(6); socioNome = socios.find((s) => s.uid === socioId)?.nome || ""; }
    const lote = writeBatch(db);
    lote.update(doc(db, "contas", c.id), { status: "paga", pagoEm: d.pagoEm, valorPago: Math.round(v * 100) / 100, pagoPor: uid, pagoPorNome: perfil.nome });
    lote.set(doc(db, "lancamentos", "conta_" + c.id), { tipo: "despesa", data: d.pagoEm, descricao: `${c.descricao}${c.parcela ? ` (${c.parcela.k}/${c.parcela.n})` : ""}`.slice(0, 200), categoria: c.categoria || "Outros", valor: Math.round(v * 100) / 100,
      socioId, socioNome, cartaoId, cartaoNome, forma, canal: "", comprovante: comp, obs: `Conta a pagar${c.fornecedor ? " · " + c.fornecedor : ""}`, contaId: c.id, criadoPor: uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp() });
    await lote.commit(); await auditar(perfil, "conta_paga", `${c.descricao}: ${brl(v)}`); dP.close(); toast("Pagamento registrado e lançado como despesa.");
  }

  // ===================== CARTÃO DA EMPRESA =====================
  function vCartao() {
    corpo.innerHTML = cartoes.length ? cartoes.map((c) => {
      const fat = listarFaturas(lancs, c, faturasPagas).slice(0, 8);
      return `<div class="card mb-5"><div class="flex flex-wrap items-center gap-3"><h3 class="h2 flex-1">${esc(c.nome)}${c.final ? ` <span class="text-ink/70">final ${esc(c.final)}</span>` : ""}</h3>${c.ativo === false ? '<span class="tag">Inativo</span>' : ""}<button class="btn-alt" data-act="editCartao" data-id="${c.id}">Editar</button></div>
        <p class="text-sm text-ink/70 mt-1">Fecha dia ${c.diaFechamento} · vence dia ${c.diaVencimento}</p>
        ${fat.length ? `<table class="mt-3"><tr><th>Fatura</th><th>Compras</th><th>Total</th><th>Fecha</th><th>Vence</th><th>Situação</th><th></th></tr>${fat.map((f) => {
          const fechada = faturaFechada(f, hoje), sit = f.paga ? `<span class="tag ok">Paga em ${fmtDia(f.pagamento.pagoEm)}</span>` : fechada ? (f.vencimento < hoje ? '<span class="tag bad">Vencida, pagar</span>' : '<span class="tag" style="background:#ffb067">Fechada, a pagar</span>') : '<span class="tag">Aberta</span>';
          return `<tr><td class="capitalize"><b>${nomeMes(f.ciclo)}</b></td><td>${f.itens.length}</td><td><b>${brl(f.total)}</b></td><td>${fmtDia(f.fechamento)}</td><td>${fmtDia(f.vencimento)}</td><td>${sit}</td>
            <td class="whitespace-nowrap"><button class="btn-alt" data-act="verFatura" data-id="${c.id}|${f.ciclo}">Compras</button>${!f.paga && fechada && f.total > 0 ? ` <button class="btn" data-act="pagarFatura" data-id="${c.id}|${f.ciclo}">Pagar fatura</button>` : ""}</td></tr>`;
        }).join("")}</table>` : '<p class="mt-3 text-ink/70">Nenhuma compra neste cartão ainda. Ao lançar uma despesa, escolha este cartão em "Quem pagou".</p>'}</div>`;
    }).join("") : '<div class="card">Nenhum cartão cadastrado. Toque em "Novo cartão" e informe o dia do fechamento e do vencimento da fatura.</div>';
  }
  function abrirCartao(c) {
    editando = c || null; fK.reset(); raiz.querySelector("#tK").textContent = c ? "Editar cartão" : "Novo cartão";
    if (c) { const x = fK.elements; x.nome.value = c.nome; x.final.value = c.final || ""; x.fech.value = c.diaFechamento; x.venc.value = c.diaVencimento; x.ativo.checked = c.ativo !== false; }
    else fK.elements.nome.value = cartoes.length ? "" : "Cartão da empresa";
    dK.showModal();
  }
  async function salvarCartao() {
    const d = Object.fromEntries(new FormData(fK)), f = Number(d.fech), v = Number(d.venc);
    if (![f, v].every((n) => Number.isInteger(n) && n >= 1 && n <= 31)) return toast("Os dias de fechamento e vencimento devem ser de 1 a 31.");
    const dados = { nome: d.nome.trim(), final: (d.final || "").trim(), diaFechamento: f, diaVencimento: v, ativo: !!d.ativo };
    if (editando) await updateDoc(doc(db, "cartoes", editando.id), dados); else await addDoc(collection(db, "cartoes"), { ...dados, criadoEm: serverTimestamp() });
    await auditar(perfil, editando ? "cartao_editado" : "cartao_criado", dados.nome); dK.close(); toast("Cartão salvo.");
  }
  const achaFatura = (ref) => { const [cid, ciclo] = ref.split("|"), c = cartoes.find((x) => x.id === cid); return { c, f: listarFaturas(lancs, c, faturasPagas).find((x) => x.ciclo === ciclo) }; };
  function verFatura(ref) {
    const { c, f } = achaFatura(ref);
    dX.innerHTML = `<div class="flex items-start gap-3"><h2 class="h2 flex-1">${esc(c.nome)} · fatura de ${nomeMes(f.ciclo)}</h2><button class="btn-alt" data-fechar="dX">Fechar</button></div>
      <p class="text-ink/70 mt-1">Fecha ${fmtDia(f.fechamento)} · vence ${fmtDia(f.vencimento)} · total <b>${brl(f.total)}</b></p>
      <table class="mt-3"><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th></tr>${[...f.itens].sort((a, b) => a.data.localeCompare(b.data)).map((l) => `<tr><td>${fmtDia(l.data)}</td><td>${esc(l.descricao)}</td><td>${esc(l.categoria)}</td><td>${brl(l.valor)}</td></tr>`).join("")}</table>`;
    dX.showModal();
  }
  function abrirFatura(ref) {
    const { c, f } = achaFatura(ref); faturaPagando = { c, f }; fF.reset();
    raiz.querySelector("#fInfo").textContent = `${c.nome} · fatura de ${nomeMes(f.ciclo)} · vence ${fmtDia(f.vencimento)} · total ${brl(f.total)}`;
    fF.elements.pagoEm.value = hoje; fF.elements.valorPago.value = num(f.total); dF.showModal();
  }
  async function pagarFatura() {
    const { c, f } = faturaPagando, d = Object.fromEntries(new FormData(fF)), v = parseBRL(d.valorPago);
    if (!(v > 0)) return toast("Informe o valor pago.");
    if (!faturaFechada(f, hoje)) return toast("A fatura ainda não fechou.");
    const id = `${c.id}_${f.ciclo}`, lote = writeBatch(db), vv = Math.round(v * 100) / 100;
    lote.set(doc(db, "faturas", id), { cartaoId: c.id, ciclo: f.ciclo, total: f.total, valorPago: vv, pagoEm: d.pagoEm, pagoPor: uid, pagoPorNome: perfil.nome, criadoEm: serverTimestamp() });
    lote.set(doc(db, "lancamentos", "fatura_" + id), { tipo: "pagamento_fatura", data: d.pagoEm, descricao: `Fatura ${c.nome} (${f.ciclo})`, categoria: "Fatura do cartão", valor: vv, socioId: "", socioNome: "", cartaoId: c.id, cartaoNome: c.nome, ciclo: f.ciclo, canal: "", comprovante: "", obs: "", criadoPor: uid, criadoPorNome: perfil.nome, criadoEm: serverTimestamp() });
    await lote.commit(); await auditar(perfil, "fatura_paga", `${c.nome} ${f.ciclo}: ${brl(vv)}`); dF.close(); toast("Fatura paga: o valor saiu do caixa.");
  }

  // ===================== GASTOS POR FORMA DE PAGAMENTO =====================
  const balde = (l) => l.cartaoId ? (l.cartaoNome || "Cartão da empresa") : l.socioId ? `Do bolso: ${l.socioNome}` : (FORMAS_PAG[l.forma] ? `${FORMAS_PAG[l.forma]} (caixa)` : "Caixa (forma não informada)");
  let tabela = [];
  function vForma() {
    const meses = Array.from({ length: 6 }, (_, i) => mesMais(mesRef, i - 5)), des = lancs.filter((l) => l.tipo === "despesa");
    const por = (m) => { const o = {}; des.filter((l) => l.data.startsWith(m)).forEach((l) => { const b = balde(l), x = o[b] || (o[b] = { total: 0, n: 0 }); x.total += l.valor; x.n++; }); return o; };
    const atual = por(mesRef), tot = Object.values(atual).reduce((s, x) => s + x.total, 0), baldes = [...new Set(meses.flatMap((m) => Object.keys(por(m))))].sort();
    const mat = Object.fromEntries(meses.map((m) => [m, por(m)]));
    tabela = [["Forma de pagamento", ...meses.map(nomeMes)], ...baldes.map((b) => [b, ...meses.map((m) => num(Math.round((mat[m][b]?.total || 0) * 100) / 100))])];
    corpo.innerHTML = `<div class="flex flex-wrap items-end gap-3 mb-4"><label>Mês<input id="mesRef" type="month" class="input" value="${mesRef}" style="margin:0"></label><span class="flex-1"></span><button class="btn-alt" data-act="csvForma">Exportar CSV</button></div>
      <div class="card mb-5"><div class="flex justify-between items-baseline"><h3 class="h2">Total gasto no mês</h3><span class="num">${brl(tot)}</span></div>
        ${Object.keys(atual).length ? `<table class="mt-3"><tr><th>Forma de pagamento</th><th>Lançamentos</th><th>Total</th><th>%</th></tr>${Object.entries(atual).sort((a, b) => b[1].total - a[1].total).map(([b, x]) => `<tr><td><b>${esc(b)}</b></td><td>${x.n}</td><td>${brl(x.total)}</td><td>${tot ? Math.round((x.total / tot) * 100) : 0}%</td></tr>`).join("")}</table>` : '<p class="mt-3 text-ink/70">Sem despesas neste mês.</p>'}</div>
      <h3 class="h2 mb-3">Últimos 6 meses</h3>${baldes.length ? `<div class="card"><table><tr><th>Forma</th>${meses.map((m) => `<th class="capitalize">${nomeMes(m)}</th>`).join("")}</tr>${baldes.map((b) => `<tr><td><b>${esc(b)}</b></td>${meses.map((m) => `<td>${mat[m][b] ? brl(mat[m][b].total) : "—"}</td>`).join("")}</tr>`).join("")}</table></div>` : '<div class="card">Sem despesas lançadas.</div>'}
      <p class="text-xs text-ink/70 mt-2">As compras no cartão aparecem no mês em que foram feitas, não no mês em que a fatura é paga.</p>`;
  }

  // ---------- eventos ----------
  raiz.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba]"); if (ab) { aba = ab.dataset.aba; return montar(); }
    const fi = e.target.closest("[data-filtro]"); if (fi) { filtro = fi.dataset.filtro; return vPagar(); }
    const fc = e.target.closest("[data-fechar]"); if (fc) return raiz.querySelector("#" + fc.dataset.fechar).close();
    const fb = e.target.closest("[data-foto]");   // câmera: chamada direta do clique
    if (fb) { try { const r = await tirarEEnviar({ pasta: "Contas a pagar", nome: (fC.elements.descricao.value || "boleto").replace(/\s+/g, "_"), carimbo: false }); if (r) { fC.elements.boleto.value = r.url; raiz.querySelector("#fotoMsg").innerHTML = '<span class="foto-ok">✔ foto enviada</span>'; } } catch (err) { erro(err); } return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act, c = contas.find((x) => x.id === b.dataset.id), k = cartoes.find((x) => x.id === b.dataset.id);
    b.disabled = true;
    try {
      if (a === "novaConta") abrirConta(null); else if (a === "editConta") abrirConta(c); else if (a === "pagar") abrirPagar(c);
      else if (a === "delConta" && confirm(`Excluir a conta "${c.descricao}"?`)) { await deleteDoc(doc(db, "contas", c.id)); await auditar(perfil, "conta_excluida", c.descricao); }
      else if (a === "novoCartao") abrirCartao(null); else if (a === "editCartao") abrirCartao(k);
      else if (a === "verFatura") verFatura(b.dataset.id); else if (a === "pagarFatura") abrirFatura(b.dataset.id);
      else if (a === "csvForma") { const t = tabela.map((l) => l.map(csvCel).join(";")).join("\r\n"), x = document.createElement("a"); x.href = URL.createObjectURL(new Blob(["\ufeff" + t], { type: "text/csv" })); x.download = `gastos-por-pagamento-${mesRef}.csv`; x.click(); }
    } catch (err) { erro(err); } finally { b.disabled = false; }
  });
  raiz.addEventListener("change", (e) => {
    if (e.target.id === "mesRef" && e.target.value) { mesRef = e.target.value; vForma(); }
    if (e.target.name === "rep" && e.target.closest("#fC")) fC.querySelectorAll("[data-rep]").forEach((x) => x.classList.toggle("hidden", e.target.value === "unica"));
    if (e.target.name === "quem" && e.target.closest("#fP")) ajustaForma();
  });
  raiz.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.target.querySelector(".btn"); btn.disabled = true;
    try { ({ fC: salvarConta, fP: confirmarPagamento, fK: salvarCartao, fF: pagarFatura })[e.target.id]?.call && await ({ fC: salvarConta, fP: confirmarPagamento, fK: salvarCartao, fF: pagarFatura })[e.target.id](); } catch (err) { erro(err); } finally { btn.disabled = false; }
  });

  // ---------- dados em tempo real ----------
  const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const L = (nome, set) => onSnapshot(collection(db, nome), (s) => { set(ver(s)); atualizar(); }, erro);
  const paradas = [L("contas", (x) => { contas = x; }), L("lancamentos", (x) => { lancs = x; }), L("cartoes", (x) => { cartoes = x; }), L("faturas", (x) => { faturasPagas = x; }),
    onSnapshot(collection(db, "categorias_fin"), (s) => { cats = ver(s).filter((c) => c.tipo === "despesa").map((c) => c.nome).sort(); }, erro)];
  montar();
  return () => paradas.forEach((p) => p());
}
