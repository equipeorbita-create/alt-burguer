// Cálculos puros do estoque (sem Firebase), fáceis de testar.
export const r3 = (n) => Math.round(n * 1000) / 1000;

export const MOTIVOS = { uso: "Uso na cozinha", descarte: "Descarte / vencido / perda" };

// Estoque de um insumo = soma dos lotes que ainda têm saldo
export const estoqueDe = (lotes, insumoId) =>
  r3(lotes.filter((l) => l.insumoId === insumoId).reduce((s, l) => s + l.qtdAtual, 0));

// PEPS: o que vence primeiro sai primeiro. Sem validade vai por último; empate = entrada mais antiga.
const SEM = "9999-12-31";
export const ordemPEPS = (a, b) =>
  (a.validade || SEM).localeCompare(b.validade || SEM) || (a.entradaEm || "").localeCompare(b.entradaEm || "");

export function planoPEPS(lotes, insumoId, qtd) {
  let falta = r3(qtd);
  const plano = [];
  for (const l of lotes.filter((x) => x.insumoId === insumoId && x.qtdAtual > 0).sort(ordemPEPS)) {
    if (falta <= 0) break;
    const t = Math.min(l.qtdAtual, falta);
    plano.push({ loteId: l.id, qtd: r3(t) });
    falta = r3(falta - t);
  }
  return { plano, falta };
}

// "2.000" = 2000, "1,5" = 1.5, "0.5" = 0.5
export function numero(s) {
  let t = String(s).trim().replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
}

// Aceita "500", "2 kg", "1,5 l". Devolve {valor} na unidade base ou {erro}.
export function parseQtd(texto, unidade) {
  const m = String(texto).trim().toLowerCase().match(/^([\d.,]+)\s*(kg|g|l|ml|un)?$/);
  if (!m) return { erro: "Digite só o número (ex.: 500, 2 kg ou 1,5 l)." };
  const n = numero(m[1]);
  if (!(n > 0)) return { erro: "Informe uma quantidade maior que zero." };
  const suf = m[2];
  if (!suf || suf === unidade) return { valor: r3(n) };
  if (unidade === "g" && suf === "kg") return { valor: r3(n * 1000) };
  if (unidade === "ml" && suf === "l") return { valor: r3(n * 1000) };
  return { erro: `Este item é medido em ${unidade}${unidade === "g" ? " (pode usar kg)" : unidade === "ml" ? " (pode usar l)" : ""}.` };
}

export const diasAte = (iso) => {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(hoje + "T00:00:00Z")) / 86400000);
};
