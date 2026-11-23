import { db, auth, firebaseConfig } from "../firebase.js";
import { traduzErro, recuperarSenha } from "../auth.js";
import { esc, toast, auditar, fmtData, PAPEIS } from "../util.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, setDoc, updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const opcoes = (sel) =>
  Object.entries(PAPEIS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

// Cria o login usando um segundo app do Firebase, para não deslogar o sócio atual.
async function criarLogin(email, senha) {
  const sec = initializeApp(firebaseConfig, "sec" + Date.now());
  try {
    const a = getAuth(sec);
    const cred = await createUserWithEmailAndPassword(a, email, senha);
    await signOut(a);
    return cred.user.uid;
  } finally {
    await deleteApp(sec);
  }
}

export async function render(el, { perfil }) {
  let lista = [];

  el.innerHTML = `
    <div class="grid gap-4 lg:grid-cols-3">
      <form id="novo" class="card space-y-4 lg:col-span-1 self-start">
        <h2 class="h2">Novo usuário</h2>
        <label>Nome<input name="nome" required class="input"></label>
        <label>E-mail<input name="email" type="email" required class="input"></label>
        <label>Senha temporária<input name="senha" type="text" minlength="6" required class="input"></label>
        <label>Perfil<select name="papel" class="input">${opcoes("funcionario")}</select></label>
        <button class="btn w-full">Criar usuário</button>
        <p class="text-xs text-ink/70">Passe a senha à pessoa por um canal seguro. Ela pode trocar depois pelo link "Esqueci minha senha" na tela de login.</p>
      </form>
      <div class="card lg:col-span-2 overflow-x-auto">
        <h2 class="h2 mb-2">Equipe</h2>
        <div id="lista">Carregando…</div>
      </div>
    </div>`;

  async function carregar() {
    const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nome")));
    lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    desenhar();
  }

  function desenhar() {
    el.querySelector("#lista").innerHTML = `
      <table>
        <tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Criado em</th><th></th></tr>
        ${lista.map((u) => {
          const eu = u.id === auth.currentUser.uid;
          return `<tr>
            <td><b>${esc(u.nome)}</b><br><small class="text-ink/70">${esc(u.email)}</small></td>
            <td><select class="input" style="margin:0;padding:8px 10px" data-act="papel" data-id="${u.id}" ${eu ? "disabled" : ""}>${opcoes(u.papel)}</select></td>
            <td><span class="tag ${u.ativo ? "ok" : "bad"}">${u.ativo ? "Ativo" : "Desativado"}</span></td>
            <td class="text-ink/70">${fmtData(u.criadoEm)}</td>
            <td class="whitespace-nowrap">
              <button class="btn-alt" data-act="toggle" data-id="${u.id}" ${eu ? "disabled" : ""}>${u.ativo ? "Desativar" : "Reativar"}</button>
              <button class="btn-alt" data-act="reset" data-id="${u.id}">Redefinir senha</button>
              ${u.papel === "admin" ? "" : `<button class="btn-alt" data-act="conf" data-id="${u.id}" ${u.papel === "gerente" ? "disabled" : ""}>${u.papel === "gerente" || u.conferente ? "Conferente ✔" : "Tornar conferente"}</button>`}
            </td></tr>`;
        }).join("")}
      </table>`;
  }

  el.querySelector("#novo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    const d = Object.fromEntries(new FormData(f));
    btn.disabled = true;
    try {
      const uid = await criarLogin(d.email.trim(), d.senha);
      await setDoc(doc(db, "usuarios", uid), {
        nome: d.nome.trim(), email: d.email.trim(), papel: d.papel, ativo: true, criadoEm: serverTimestamp()
      });
      await auditar(perfil, "usuario_criado", `${d.nome.trim()} (${d.papel})`);
      f.reset();
      toast("Usuário criado.");
      await carregar();
    } catch (err) {
      console.error(err);
      toast(traduzErro(err));
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelector("#lista").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const u = lista.find((x) => x.id === b.dataset.id);
    try {
      if (b.dataset.act === "toggle") {
        await updateDoc(doc(db, "usuarios", u.id), { ativo: !u.ativo });
        await auditar(perfil, u.ativo ? "usuario_desativado" : "usuario_reativado", u.nome);
        toast(u.ativo ? "Usuário desativado." : "Usuário reativado.");
        await carregar();
      } else if (b.dataset.act === "conf") {
        await updateDoc(doc(db, "usuarios", u.id), { conferente: !u.conferente });
        await auditar(perfil, u.conferente ? "conferente_removido" : "conferente_definido", u.nome);
        toast(u.conferente ? "Deixou de conferir recebimentos." : "Agora confere os recebimentos do estoque.");
        await carregar();
      } else if (b.dataset.act === "reset") {
        await recuperarSenha(u.email);
        await auditar(perfil, "senha_redefinicao_enviada", u.nome);
        toast("E-mail de redefinição enviado.");
      }
    } catch (err) {
      console.error(err);
      toast(traduzErro(err));
    }
  });

  el.querySelector("#lista").addEventListener("change", async (e) => {
    const s = e.target.closest("select[data-act='papel']");
    if (!s) return;
    const u = lista.find((x) => x.id === s.dataset.id);
    try {
      await updateDoc(doc(db, "usuarios", u.id), { papel: s.value });
      await auditar(perfil, "usuario_perfil_alterado", `${u.nome}: ${u.papel} → ${s.value}`);
      toast("Perfil atualizado.");
      await carregar();
    } catch (err) {
      console.error(err);
      toast(traduzErro(err));
      await carregar();
    }
  });

  await carregar();
}
