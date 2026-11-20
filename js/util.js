import { auth, db } from "./firebase.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const PAPEIS = {
  admin: "Sócio / Admin",
  gerente: "Gerente da cozinha",
  funcionario: "Funcionário"
};

// Evita que texto digitado vire HTML (segurança)
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtData = (ts) =>
  ts?.toDate ? ts.toDate().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }) : "—";

export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 3000);
}

// Histórico de alterações (somente inclusão; as regras bloqueiam editar ou apagar)
export async function auditar(perfil, acao, detalhe = "") {
  try {
    await addDoc(collection(db, "auditoria"), {
      uid: auth.currentUser.uid,
      nome: perfil.nome,
      acao,
      detalhe,
      em: serverTimestamp()
    });
  } catch (e) {
    console.error("Falha ao registrar auditoria", e);
  }
}

// ---------- Fase 2 ----------
export const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
export const fmtDia = (d) => (d ? d.split("-").reverse().join("/") : "");

const _brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (v) => _brl.format(Number(v) || 0);

// Aceita "4.200,50", "4200,50", "4200.50" e "4.200"
export function parseBRL(s) {
  let t = String(s).replace(/[R$\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}
