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
