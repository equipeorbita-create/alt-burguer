import { auth } from "../firebase.js";
import { DRIVE_URL } from "../drive-config.js";

export const driveConfigurado = () => /^https:\/\/script\.google\.com\//.test(DRIVE_URL);

const dataHora = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(",", "");

const carregarImagem = (arq) => new Promise((ok, falha) => {
  const u = URL.createObjectURL(arq), img = new Image();
  img.onload = () => { URL.revokeObjectURL(u); ok(img); };
  img.onerror = () => { URL.revokeObjectURL(u); falha(new Error("FOTO_INVALIDA")); };
  img.src = u;
});

// Reduz a foto (economiza espaço e internet) e, se pedido, grava data e hora na própria imagem.
export async function prepararFoto(arq, { carimbo = false, texto = "", maxLado = 1600, qualidade = 0.82 } = {}) {
  const img = await carregarImagem(arq), esc = Math.min(1, maxLado / Math.max(img.width, img.height));
  const w = Math.round(img.width * esc), h = Math.round(img.height * esc);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
  if (carimbo) {
    const linha = `${dataHora()}${texto ? " · " + texto : ""}`;
    let tam = Math.max(18, Math.round(w * 0.03)); x.font = `700 ${tam}px sans-serif`;
    const pad = Math.round(tam * 0.5);
    while (x.measureText(linha).width > w - pad * 2 && tam > 12) { tam -= 1; x.font = `700 ${tam}px sans-serif`; }
    x.fillStyle = "rgba(0,0,0,0.65)"; x.fillRect(0, h - tam - pad * 2, w, tam + pad * 2);
    x.fillStyle = "#fff"; x.textBaseline = "middle"; x.fillText(linha, pad, h - (tam + pad * 2) / 2);
  }
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", qualidade));
}

// IMPORTANTE: chamar direto do clique (sem "await" antes), senão o celular bloqueia a câmera.
export function escolherFoto({ camera = true } = {}) {
  return new Promise((ok) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*"; i.style.display = "none";
    if (camera) i.setAttribute("capture", "environment");   // abre a câmera (não deixa pegar da galeria)
    document.body.appendChild(i);
    i.addEventListener("change", () => { ok(i.files[0] || null); i.remove(); });
    i.addEventListener("cancel", () => { ok(null); i.remove(); });
    i.click();
  });
}

async function paraBase64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function enviarParaDrive(blob, { pasta, nome }) {
  if (!driveConfigurado()) throw new Error("DRIVE_NAO_CONFIGURADO");
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(DRIVE_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, pasta, nome: `${new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" })}_${nome}`, dados: await paraBase64(blob) }) });
  const j = await r.json();
  if (!j.ok) throw new Error("UPLOAD_FALHOU");
  return { id: j.id, url: j.url };
}

// Tira (ou escolhe) a foto, reduz, carimba se pedido e envia ao Drive. Devolve {id,url} ou null se cancelou.
export async function tirarEEnviar({ pasta, nome, carimbo = true, texto = "", camera = true }) {
  const arq = await escolherFoto({ camera });
  if (!arq) return null;
  return enviarParaDrive(await prepararFoto(arq, { carimbo, texto }), { pasta, nome });
}

export const MSG_FOTO = {
  DRIVE_NAO_CONFIGURADO: "O envio de fotos ainda não foi configurado. Veja o guia (Apps Script).",
  UPLOAD_FALHOU: "Não foi possível enviar a foto. Verifique a internet e tente de novo.",
  FOTO_INVALIDA: "Essa imagem não pôde ser lida. Tente tirar outra foto."
};
