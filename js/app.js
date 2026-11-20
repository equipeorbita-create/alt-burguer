import { observarSessao, sair } from "./auth.js";
import { esc, PAPEIS } from "./util.js";

// Cada módulo novo das próximas fases entra aqui.
const MODULOS = {
  inicio:   { nome: "Início",   papeis: ["admin", "gerente", "funcionario"], carregar: () => import("./modules/inicio.js") },
  tarefas:  { nome: "Tarefas",  papeis: ["admin", "gerente"],               carregar: () => import("./modules/tarefas.js") },
  fornecedores: { nome: "Fornecedores", papeis: ["admin"],                  carregar: () => import("./modules/fornecedores.js") },
  patrimonio: { nome: "Patrimônio", papeis: ["admin"],                    carregar: () => import("./modules/patrimonio.js") },
  usuarios: { nome: "Usuários", papeis: ["admin"],                          carregar: () => import("./modules/usuarios.js") }
};

const $ = (id) => document.getElementById(id);
let perfil = null;
let iniciado = false;
let limpar = null; // função de limpeza do módulo aberto (ex.: parar escuta em tempo real)

observarSessao((p) => {
  if (!p) return location.replace("index.html");
  perfil = p;
  $("quem").innerHTML = `<b>${esc(p.nome)}</b><br><span class="text-off/60 text-sm">${esc(PAPEIS[p.papel] || p.papel)}</span>`;
  $("menu").innerHTML = Object.entries(MODULOS)
    .filter(([, m]) => m.papeis.includes(p.papel))
    .map(([k, m]) => `<a class="nav" data-k="${k}" href="#/${k}">${m.nome}</a>`).join("");
  if (!iniciado) {
    iniciado = true;
    window.addEventListener("hashchange", rotear);
    $("sair").addEventListener("click", async () => { await sair(); location.replace("index.html"); });
    $("abrir").addEventListener("click", () => $("lateral").classList.toggle("-translate-x-full"));
  }
  rotear();
});

async function rotear() {
  if (limpar) { limpar(); limpar = null; }
  const chave = location.hash.replace("#/", "") || "inicio";
  const m = MODULOS[chave];
  const main = $("conteudo");
  $("lateral").classList.add("-translate-x-full");
  if (!m || !m.papeis.includes(perfil.papel)) {
    main.innerHTML = `<div class="card">Você não tem acesso a esta página.</div>`;
    return;
  }
  document.querySelectorAll("#menu a").forEach((a) => a.classList.toggle("on", a.dataset.k === chave));
  $("titulo").textContent = m.nome;
  main.innerHTML = `<p class="text-off/60">Carregando…</p>`;
  try {
    const mod = await m.carregar();
    main.innerHTML = "";
    const r = await mod.render(main, { perfil });
    limpar = typeof r === "function" ? r : null;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card">Não foi possível carregar esta página.</div>`;
  }
}
