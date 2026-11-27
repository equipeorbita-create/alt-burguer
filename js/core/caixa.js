// Fechamento de caixa, cartão da empresa, contas a pagar e projeção do fluxo de caixa (funções puras).
import { somaDias } from "./rotinas.js";

const arred = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();   // mes de 1 a 12

// Formas de receber do movimento da loja. Taxa e prazo começam em zero: o sócio preenche em "Taxas e prazos".
export const FORMAS_PADRAO = [
  { id: "dinheiro", nome: "Dinheiro", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "pix", nome: "PIX", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "debito", nome: "Cartão de débito", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "credito", nome: "Cartão de crédito", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "vale", nome: "Vale-refeição / alimentação", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "ifood", nome: "iFood", taxaPct: 0, prazoDias: 0, ativo: true },
  { id: "99food", nome: "99Food", taxaPct: 0, prazoDias: 0, ativo: true }
];

export const calcVenda = (forma, bruto) => {
  const taxa = arred((bruto * (forma.taxaPct || 0)) / 100);
  return { bruto: arred(bruto), taxa, liquido: arred(bruto - taxa), prazo: forma.prazoDias || 0 };
};
// Dinheiro que deveria estar na gaveta ao fechar o dia
export const esperadoGaveta = ({ fundo = 0, dinheiro = 0, sangrias = 0, despesasDinheiro = 0 }) => arred(fundo + dinheiro - sangrias - despesasDinheiro);

export function mesMais(ym, n) {
  const [a, m] = ym.split("-").map(Number), t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function adicionarMeses(iso, n) {   // 31/01 + 1 mês = 28/02 (ou 29)
  const [a, m, d] = iso.split("-").map(Number), alvo = mesMais(`${a}-${pad(m)}`, n), [aa, mm] = alvo.split("-").map(Number);
  return `${alvo}-${pad(Math.min(d, ultimoDia(aa, mm)))}`;
}
export function dividirParcelas(total, n) {   // sem perder centavos: 100,00 em 3 = 33,34 + 33,33 + 33,33
  const c = Math.round(total * 100), base = Math.floor(c / n), resto = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

// ----- Cartão da empresa -----
// A compra entra na fatura que fecha no dia de fechamento ou depois dela (compra no dia do fechamento ainda entra nessa fatura).
export function cicloDaCompra(dataISO, diaFech) {
  const [a, m, d] = dataISO.split("-").map(Number);
  return d <= Math.min(diaFech, ultimoDia(a, m)) ? `${a}-${pad(m)}` : mesMais(`${a}-${pad(m)}`, 1);
}
export function fechamentoDoCiclo(ym, diaFech) {
  const [a, m] = ym.split("-").map(Number);
  return `${ym}-${pad(Math.min(diaFech, ultimoDia(a, m)))}`;
}
export function vencimentoDoCiclo(ym, diaFech, diaVenc) {   // vence no mesmo mês se o vencimento é depois do fechamento; senão, no mês seguinte
  const ref = diaVenc > diaFech ? ym : mesMais(ym, 1), [a, m] = ref.split("-").map(Number);
  return `${ref}-${pad(Math.min(diaVenc, ultimoDia(a, m)))}`;
}
// faturasPagas: lista de {cartaoId, ciclo, ...}
export function listarFaturas(lancs, cartao, faturasPagas = []) {
  const por = {};
  for (const l of lancs) {
    if (l.tipo !== "despesa" || l.cartaoId !== cartao.id) continue;
    const c = cicloDaCompra(l.data, cartao.diaFechamento);
    (por[c] = por[c] || { total: 0, itens: [] }).total += l.valor;
    por[c].itens.push(l);
  }
  return Object.entries(por).map(([ciclo, v]) => {
    const paga = faturasPagas.find((f) => f.cartaoId === cartao.id && f.ciclo === ciclo);
    return { cartaoId: cartao.id, cartaoNome: cartao.nome, ciclo, total: arred(v.total), itens: v.itens, fechamento: fechamentoDoCiclo(ciclo, cartao.diaFechamento),
      vencimento: vencimentoDoCiclo(ciclo, cartao.diaFechamento, cartao.diaVencimento), paga: !!paga, pagamento: paga || null };
  }).sort((a, b) => b.ciclo.localeCompare(a.ciclo));
}
export const faturaFechada = (f, hoje) => hoje > f.fechamento;

// ----- Entradas que vêm do fechamento (entram no caixa como se fossem lançamentos) -----
export function entradasSinteticas(fechs, recebs) {
  const out = [];
  for (const f of fechs) {
    if (f.status !== "fechado") continue;
    for (const v of f.vendas || []) if (!v.prazo && v.liquido > 0) out.push({ id: `fech_${f.id}_${v.formaId}`, tipo: "entrada", data: f.data, valor: v.liquido, categoria: "Faturamento", canal: v.nome,
      descricao: `Fechamento do dia · ${v.nome}`, socioId: "", socioNome: "", sintetico: true });
  }
  for (const r of recebs) if (r.status === "recebido") out.push({ id: `rec_${r.id}`, tipo: "entrada", data: r.recebidoEm || r.previsto, valor: r.liquido, categoria: "Faturamento", canal: r.formaNome,
    descricao: `Recebimento · ${r.formaNome} (vendas de ${r.data})`, socioId: "", socioNome: "", sintetico: true });
  return out;
}

// ----- Projeção do caixa nos próximos dias -----
// O primeiro dia (hoje) junta também o que já está vencido e não foi baixado.
export function projecaoFluxo({ saldo, recebiveis, contas, faturas, hoje, dias = 30 }) {
  const linhas = []; let acc = saldo;
  for (let i = 0; i <= dias; i++) {
    const d = somaDias(hoje, i), bate = (x) => (i === 0 ? x <= d : x === d);
    const rec = recebiveis.filter((r) => r.status === "previsto" && bate(r.previsto)).reduce((s, r) => s + r.liquido, 0);
    const pag = contas.filter((c) => c.status === "aberta" && bate(c.vencimento)).reduce((s, c) => s + c.valor, 0)
      + faturas.filter((f) => !f.paga && f.total > 0 && bate(f.vencimento)).reduce((s, f) => s + f.total, 0);
    acc = arred(acc + rec - pag);
    if (rec || pag || i === 0 || i === dias) linhas.push({ data: d, receber: arred(rec), pagar: arred(pag), saldo: acc });
  }
  return linhas;
}

// Formas de pagamento das despesas pagas pelo caixa ou pelo bolso de um sócio
export const FORMAS_PAG = { dinheiro: "Dinheiro", pix: "PIX", debito: "Débito", boleto: "Boleto", transferencia: "Transferência", outra: "Outra" };
