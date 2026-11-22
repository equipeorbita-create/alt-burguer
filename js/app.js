import { observarSessao, sair } from "./auth.js";
import { esc, PAPEIS } from "./util.js";

// Ícones simples (24x24, traço). Cada módulo novo das próximas fases entra em MODULOS.
const ICONES = {
  inicio: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  tarefas: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  financeiro: "M12 2v20M17 6.5C16 5 14.5 4.5 12 4.5c-3 0-5 1.4-5 3.5s2 3 5 3.5 5 1.4 5 3.5-2 3.5-5 3.5c-2.5 0-4.5-.7-5.5-2.5",
  societario: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  fornecedores: "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  patrimonio: "M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.5L12 12.5l8.7-5M12 22V12.5",
  usuarios: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  estoque: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  cardapio: "M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z",
  portal: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  equipe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  relatorios: "M18 20V10M12 20V4M6 20v-6",
  mais: "M4 6h16M4 12h16M4 18h16"
};
const icone = (k) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONES[k]}"/></svg>`;

const MODULOS = {
  inicio:       { nome: "Início",       icone: "inicio",       papeis: ["admin", "gerente", "funcionario"], carregar: () => import("./modules/inicio.js") },
  portal:       { nome: "Portal",       icone: "portal",       papeis: ["admin", "gerente", "funcionario"], carregar: () => import("./modules/portal.js") },
  tarefas:      { nome: "Tarefas",      icone: "tarefas",      papeis: ["admin", "gerente"],               carregar: () => import("./modules/tarefas.js") },
  estoque:      { nome: "Estoque",      icone: "estoque",      papeis: ["admin", "gerente", "funcionario"], carregar: () => import("./modules/estoque.js") },
  cardapio:     { nome: "Cardápio",     icone: "cardapio",     papeis: ["admin", "gerente", "funcionario"], carregar: () => import("./modules/cardapio.js") },
  equipe:       { nome: "Equipe",       icone: "equipe",       papeis: ["admin", "gerente"],               carregar: () => import("./modules/equipe.js") },
  financeiro:   { nome: "Financeiro",   icone: "financeiro",   papeis: ["admin"],                          carregar: () => import("./modules/financeiro.js") },
  societario:   { nome: "Societário",   icone: "societario",   papeis: ["admin"],                          carregar: () => import("./modules/societario.js") },
  fornecedores: { nome: "Fornecedores", icone: "fornecedores", papeis: ["admin"],                          carregar: () => import("./modules/fornecedores.js") },
  patrimonio:   { nome: "Patrimônio",   icone: "patrimonio",   papeis: ["admin"],                          carregar: () => import("./modules/patrimonio.js") },
  relatorios:   { nome: "Relatórios",   icone: "relatorios",   papeis: ["admin"],                          carregar: () => import("./modules/relatorios.js") },
  usuarios:     { nome: "Usuários",     icone: "usuarios",     papeis: ["admin"],                          carregar: () => import("./modules/usuarios.js") }
};

// Barra inferior do celular: os atalhos mais usados de cada perfil (o resto fica em "Mais")
const DESTAQUE = {
  admin: ["inicio", "estoque", "cardapio", "financeiro"],
  gerente: ["inicio", "portal", "estoque", "cardapio"],
  funcionario: ["inicio", "portal", "estoque", "cardapio"]
};

const $ = (id) => document.getElementById(id);
let perfil = null;
let iniciado = false;
let limpar = null; // função de limpeza do módulo aberto (ex.: parar escuta em tempo real)

const menu = (aberto) => {
  $("lateral").classList.toggle("aberta", aberto);
  $("scrim").classList.toggle("on", aberto);
};

observarSessao((p) => {
  if (!p) return location.replace("index.html");
  perfil = p;
  const lista = Object.entries(MODULOS).filter(([, m]) => m.papeis.includes(p.papel));

  $("quem").innerHTML = `<b>${esc(p.nome)}</b><br><span>${esc(PAPEIS[p.papel] || p.papel)}</span>`;
  $("inicial").textContent = (p.nome || "?").trim().charAt(0).toUpperCase();
  $("menu").innerHTML = lista.map(([k, m]) =>
    `<a class="nav" data-k="${k}" href="#/${k}">${icone(m.icone)}<span>${m.nome}</span></a>`).join("");

  // Celular: barra inferior com os 4 primeiros módulos + "Mais" (abre o menu completo)
  const fixos = lista.length <= 5 ? lista : (DESTAQUE[p.papel] || []).map((k) => lista.find(([x]) => x === k)).filter(Boolean);
  $("bottom").innerHTML = fixos.map(([k, m]) =>
    `<a data-k="${k}" href="#/${k}">${icone(m.icone)}<span>${m.nome}</span></a>`).join("") +
    (lista.length > 5 ? `<button type="button" id="mais">${icone("mais")}<span>Mais</span></button>` : "");

  if (!iniciado) {
    iniciado = true;
    window.addEventListener("hashchange", rotear);
    $("sair").addEventListener("click", async () => { await sair(); location.replace("index.html"); });
    $("abrir").addEventListener("click", () => menu(true));
    $("scrim").addEventListener("click", () => menu(false));
    $("bottom").addEventListener("click", (e) => { if (e.target.closest("#mais")) menu(true); });
    observarTabelas();
  }
  rotear();
});

async function rotear() {
  if (limpar) { limpar(); limpar = null; }
  const chave = location.hash.replace("#/", "") || "inicio";
  const m = MODULOS[chave];
  const main = $("conteudo");
  menu(false);
  window.scrollTo(0, 0);
  if (!m || !m.papeis.includes(perfil.papel)) {
    $("titulo").textContent = "Sem acesso";
    main.innerHTML = `<div class="card">Você não tem acesso a esta página.</div>`;
    return;
  }
  document.querySelectorAll("#menu a, #bottom a").forEach((a) => a.classList.toggle("on", a.dataset.k === chave));
  $("titulo").textContent = m.nome;
  document.title = `${m.nome} · ALT BURGUER`;
  main.innerHTML = `<p class="text-ink/70">Carregando…</p>`;
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

// No celular, tabelas viram cartões. Aqui cada célula recebe o nome da sua coluna
// (feito automaticamente, para todas as telas, inclusive as das próximas fases).
function rotularTabelas() {
  document.querySelectorAll("#conteudo table:not([data-resp])").forEach((t) => {
    t.dataset.resp = "1";
    const linhas = [...t.querySelectorAll("tr")];
    const cab = linhas.find((tr) => tr.children.length && [...tr.children].every((c) => c.tagName === "TH"));
    if (!cab) { if (!t.querySelector("th")) t.classList.add("stack"); return; }
    const nomes = [...cab.children].map((th) => th.textContent.trim());
    cab.classList.add("cab");
    t.classList.add("resp");
    linhas.forEach((tr) => {
      if (tr === cab) return;
      let i = 0;
      [...tr.children].forEach((td) => {
        td.dataset.label = td.colSpan > 1 ? "" : (nomes[i] || "");
        i += td.colSpan || 1;
      });
    });
  });
}
function observarTabelas() {
  let quadro = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(quadro);
    quadro = requestAnimationFrame(rotularTabelas);
  }).observe($("conteudo"), { childList: true, subtree: true });
}
