// GTIN / EAN (padrão brasileiro): validação, normalização e consulta de dados do produto.
// Funções puras (sem Firebase), fáceis de testar.

export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");

// Dígito verificador (módulo 10): pesos 3 e 1, começando pelo dígito mais à direita do corpo
export function digitoGtin(corpo) {
  const d = soDigitos(corpo).split("").reverse();
  const soma = d.reduce((s, x, i) => s + Number(x) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (soma % 10)) % 10);
}

// Vale para EAN-8, UPC-A (12), EAN-13 e GTIN-14 (caixa)
export function gtinValido(codigo) {
  const c = soDigitos(codigo);
  return [8, 12, 13, 14].includes(c.length) && digitoGtin(c.slice(0, -1)) === c.slice(-1);
}

// Códigos brasileiros: 13 dígitos começando com 789 ou 790
export const paisGtin = (codigo) => {
  const c = soDigitos(codigo);
  return c.length === 13 && (c.startsWith("789") || c.startsWith("790")) ? "Brasil" : "";
};

// Formas equivalentes do mesmo código, para comparar:
//  - UPC-A / EAN-8 / EAN-13 viram 14 dígitos com zeros à esquerda (036000291452 = 0036000291452)
//  - GTIN-14 de caixa (DUN-14) também gera o código da unidade correspondente
//  - texto que não é número (ex.: o QR interno "ALT-XXXXXX") é comparado como está
export function candidatos(codigo) {
  const c = soDigitos(codigo);
  if (!/^\d{6,14}$/.test(c) || c !== String(codigo).trim()) {
    return /^\d{6,14}$/.test(c) && c.length >= 6 ? [c.padStart(14, "0")] : [String(codigo).trim()];
  }
  const out = [c.padStart(14, "0")];
  if (c.length === 14 && c[0] !== "0") {
    const ref = c.slice(1, 13);
    out.push("0" + ref + digitoGtin(ref));
  }
  return out;
}
export const mesmoCodigo = (a, b) => { const y = candidatos(b); return candidatos(a).some((x) => y.includes(x)); };

// "500 g", "1,5 kg", "1 L", "33 cl" -> quantidade na unidade base do sistema (g ou ml)
export function parseQuantidade(texto) {
  const m = String(texto || "").toLowerCase().replace(",", ".").match(/^\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]), f = { kg: 1000, g: 1, l: 1000, cl: 10, ml: 1 }[m[2]];
  return { qtd: Math.round(n * f * 1000) / 1000, unidade: ["kg", "g"].includes(m[2]) ? "g" : "ml" };
}

// Consulta a base aberta Open Food Facts (gratuita, colaborativa). Devolve null se não achar.
export async function consultarGTIN(codigo, { fetchFn = (...a) => fetch(...a), timeoutMs = 8000 } = {}) {
  const c = soDigitos(codigo);
  if (c.length < 8) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=product_name,product_name_pt,brands,quantity`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j && j.status === 1 ? j.product : null;
    const nome = String((p && (p.product_name_pt || p.product_name)) || "").trim();
    if (!nome) return null;
    const marca = String(p.brands || "").split(",")[0].trim();
    const q = parseQuantidade(p.quantity);
    return { nome: marca && !nome.toLowerCase().includes(marca.toLowerCase()) ? `${nome} ${marca}` : nome, marca, qtdTexto: String(p.quantity || "").trim(), ...(q || {}) };
  } finally {
    clearTimeout(t);
  }
}
