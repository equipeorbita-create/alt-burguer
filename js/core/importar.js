// Importação de insumos por planilha CSV (Excel: "Salvar como CSV"). Funções puras.
import { numero } from "./estoque-calc.js";
import { soDigitos, candidatos } from "./gtin.js";

export const MODELO_CSV = "nome;categoria;unidade;qtd_embalagem;preco_embalagem;estoque_minimo;gtin\r\n" +
  "Blend bovino 150 g;Carnes;g;5000;165,00;3000;\r\n" +
  "Óleo de soja 900 ml;Mercearia;ml;900;8,50;1800;7891234567895\r\n";

// Lê CSV com ; ou , e aspas
export function parseCSV(texto) {
  const t = String(texto).replace(/^\uFEFF/, "");
  const linha1 = t.split(/\r?\n/)[0] || "";
  const sep = (linha1.match(/;/g) || []).length >= (linha1.match(/,/g) || []).length && linha1.includes(";") ? ";" : ",";
  const rows = []; let cel = "", row = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false; } else cel += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === sep) { row.push(cel); cel = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cel); cel = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cel += ch;
  }
  row.push(cel); if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const chave = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const COLS = {
  nome: ["nome", "insumo", "produto"], categoria: ["categoria"], unidade: ["unidade", "un"],
  qtd: ["qtd_embalagem", "quantidade_embalagem", "qtd_por_embalagem", "embalagem"],
  preco: ["preco_embalagem", "preco", "valor"], minimo: ["estoque_minimo", "minimo"], gtin: ["gtin", "ean", "codigo_de_barras", "codigo"]
};

// existentes: lista de códigos já cadastrados (já normalizados por candidatos())
export function validarLinhas(rows, existentes = []) {
  if (rows.length < 2) return { validas: [], erros: [{ linha: 1, msg: "A planilha precisa ter o cabeçalho e ao menos uma linha." }] };
  const cab = rows[0].map(chave), idx = {};
  for (const [k, nomes] of Object.entries(COLS)) idx[k] = cab.findIndex((c) => nomes.includes(c));
  const faltam = ["nome", "unidade", "qtd"].filter((k) => idx[k] < 0);
  if (faltam.length) return { validas: [], erros: [{ linha: 1, msg: `Faltam colunas no cabeçalho: ${faltam.map((k) => ({ nome: "nome", unidade: "unidade", qtd: "qtd_embalagem" }[k])).join(", ")}.` }] };

  const vistos = new Set(existentes), validas = [], erros = [];
  rows.slice(1).forEach((r, n) => {
    const linha = n + 2, g = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "");
    const nome = g("nome"), un = g("unidade").toLowerCase();
    const qtd = numero(g("qtd")), preco = g("preco") ? numero(g("preco").replace(/R\$\s*/i, "")) : 0, min = g("minimo") ? numero(g("minimo")) : 0;
    if (!nome) return erros.push({ linha, msg: "Sem nome." });
    if (!["g", "ml", "un"].includes(un)) return erros.push({ linha, msg: `"${nome}": unidade deve ser g, ml ou un.` });
    if (!(qtd > 0)) return erros.push({ linha, msg: `"${nome}": quantidade por embalagem inválida.` });
    if (isNaN(preco) || preco < 0) return erros.push({ linha, msg: `"${nome}": preço inválido.` });
    if (isNaN(min) || min < 0) return erros.push({ linha, msg: `"${nome}": estoque mínimo inválido.` });
    const eans = [...new Set(g("gtin").split(/[\s,]+/).map(soDigitos).filter(Boolean))].slice(0, 5);
    const dup = eans.find((e) => candidatos(e).some((c) => vistos.has(c)));
    if (dup) return erros.push({ linha, msg: `"${nome}": o código ${dup} já está cadastrado ou repetido na planilha.` });
    eans.forEach((e) => candidatos(e).forEach((c) => vistos.add(c)));
    validas.push({ nome, categoria: g("categoria"), unidade: un, qtdEmbalagem: qtd, preco, estoqueMinimo: min, eans });
  });
  return { validas, erros };
}
