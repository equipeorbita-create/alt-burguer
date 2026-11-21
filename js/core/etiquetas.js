import { carregarScript } from "./scripts.js";
import { esc } from "../util.js";

const LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";

// Gera o QR como SVG (desenhado por nós a partir da matriz, sem depender de opções da biblioteca)
export async function qrSvg(texto) {
  await carregarScript(LIB);
  const q = window.qrcode(0, "M");
  q.addData(String(texto));
  q.make();
  const n = q.getModuleCount(), m = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const t = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR ${esc(texto)}"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export const htmlEtiqueta = (insumo, svg) =>
  `<div class="etq"><div class="etq-qr">${svg}</div><b>${esc(insumo.nome)}</b><span>${esc(insumo.qr)}</span></div>`;

// Imprime uma ou várias etiquetas (no celular abre as opções de impressão/PDF)
export async function imprimirEtiquetas(insumos) {
  const itens = await Promise.all(insumos.map(async (i) => htmlEtiqueta(i, await qrSvg(i.qr))));
  const area = document.createElement("div");
  area.id = "areaImpressao";
  area.innerHTML = `<div class="etq-grid">${itens.join("")}</div>`;
  document.body.appendChild(area);
  document.body.classList.add("imprimir-etiquetas");
  const limpar = () => {
    area.remove();
    document.body.classList.remove("imprimir-etiquetas");
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
}
