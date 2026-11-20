import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Lê o perfil (papel) do usuário em usuarios/{uid}
async function carregarPerfil(user) {
  const snap = await getDoc(doc(db, "usuarios", user.uid));
  if (!snap.exists() || snap.data().ativo !== true) return null;
  return { uid: user.uid, email: user.email, ...snap.data() };
}

export async function entrar(email, senha) {
  const cred = await signInWithEmailAndPassword(auth, email, senha);
  const perfil = await carregarPerfil(cred.user);
  if (!perfil) {
    await signOut(auth);
    throw new Error("SEM_ACESSO");
  }
  return perfil;
}

// cb(perfil) quando logado e ativo; cb(null) quando não há sessão válida
export function observarSessao(cb) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return cb(null);
    try {
      const perfil = await carregarPerfil(user);
      if (!perfil) {
        await signOut(auth);
        return cb(null);
      }
      cb(perfil);
    } catch (e) {
      console.error(e);
      cb(null);
    }
  });
}

export const sair = () => signOut(auth);
export const recuperarSenha = (email) => sendPasswordResetEmail(auth, email);

export function traduzErro(e) {
  const c = e?.code || e?.message || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "E-mail ou senha incorretos.";
  if (c.includes("too-many-requests")) return "Muitas tentativas. Aguarde um pouco e tente de novo.";
  if (c.includes("network-request-failed")) return "Sem conexão com a internet.";
  if (c.includes("SEM_ACESSO")) return "Seu acesso não está ativo. Fale com um sócio.";
  if (c.includes("email-already-in-use")) return "Já existe um login com esse e-mail.";
  if (c.includes("weak-password")) return "A senha precisa ter ao menos 6 caracteres.";
  if (c.includes("invalid-email")) return "E-mail inválido.";
  if (c.includes("permission-denied")) return "Sem permissão para essa ação.";
  return "Algo deu errado. Tente novamente.";
}
