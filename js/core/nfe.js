// Leitura de NF-e / NFC-e (arquivo XML) e vínculo dos itens com os insumos. Funções puras.
import { soDigitos, mesmoCodigo } from "./gtin.js";

const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`)); return m ? dec(m[1].trim()) : ""; };
const blocos = (x, n) => [...x.matchAll(new RegExp(`<${n}(?:\\s[^>]*)?>[\\s\\S]*?</${n}>`, "g"))].map((m) => m[0]);
const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

export const chaveForn = (cnpj, cProd) => `${cnpj}_${cProd}`.replace(/[^A-Za-z0-9_-]/g, "_");

export function parseNFe(xml) {
  if (!/<infNFe[\s>]/.test(xml)) throw new Error("XML_INVALIDO");
  const emit = blocos(xml, "emit")[0] || "", ide = blocos(xml, "ide")[0] || "";
  const itens = blocos(xml, "det").map((det) => {
    const p = blocos(det, "prod")[0] || "";
    return { cProd: tag(p, "cProd"), ean: tag(p, "cEAN"), xProd: tag(p, "xProd"), uCom: tag(p, "uCom"), qCom: num(tag(p, "qCom")),
      vUnCom: num(tag(p, "vUnCom")), vProd: num(tag(p, "vProd")), vDesc: num(tag(p, "vDesc")) };
  });
  if (!itens.length) throw new Error("XML_SEM_ITENS");
  return {
    chave: (xml.match(/Id="NFe(\d{44})"/) || [])[1] || "", numero: tag(ide, "nNF"), serie: tag(ide, "serie"),
    emissao: (tag(ide, "dhEmi") || tag(ide, "dEmi")).slice(0, 10), emitente: tag(emit, "xNome"), cnpj: tag(emit, "CNPJ") || tag(emit, "CPF"),
    total: num(tag(blocos(xml, "ICMSTot")[0] || "", "vNF")), itens
  };
}

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ");
const STOP = new Set(["de", "da", "do", "com", "sem", "kg", "gr", "ml", "un", "pct", "cx", "lt", "tipo", "marca"]);
const tokens = (s) => new Set(norm(s).split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t)));
const jaccard = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; return a.size + b.size - i ? i / (a.size + b.size - i) : 0; };
const codigosDe = (i) => [...(i.eans || []), ...(i.ean ? [i.ean] : [])];

// Vincula a linha da nota a um insumo: 1) código de barras, 2) código do fornecedor já aprendido, 3) nome parecido
export function sugerirInsumo(item, insumos, cnpj) {
  const ean = soDigitos(item.ean);
  if (ean.length >= 8 && !/sem/i.test(item.ean)) {
    const i = insumos.find((x) => codigosDe(x).some((c) => mesmoCodigo(c, ean)));
    if (i) return { insumo: i, motivo: "gtin" };
  }
  const k = chaveForn(cnpj, item.cProd), p = insumos.find((x) => x.nfe && x.nfe[k]);
  if (p) return { insumo: p, motivo: "codigo" };
  const t = tokens(item.xProd);
  let melhor = null, nota = 0;
  for (const i of insumos) { const s = jaccard(t, tokens(i.nome)); if (s > nota) { nota = s; melhor = i; } }
  return nota >= 0.5 ? { insumo: melhor, motivo: "nome" } : { insumo: null, motivo: null };
}

// Quantas embalagens do insumo a linha da nota representa (kg viram g, L viram ml; o resto conta como embalagens)
export function embalagensDe(item, insumo) {
  const u = String(item.uCom || "").toUpperCase(), q = item.qCom;
  let base = null;
  if (insumo.unidade === "g") base = u === "KG" ? q * 1000 : (u === "G" || u === "GR") ? q : null;
  else if (insumo.unidade === "ml") base = (u === "L" || u === "LT") ? q * 1000 : u === "ML" ? q : null;
  return { emb: Math.round((base != null ? base / insumo.qtdEmbalagem : q) * 1000) / 1000, convertido: base != null };
}
export const valorDaLinha = (item) => r2(item.vProd - item.vDesc);
