import { esc, PAPEIS } from "../util.js";

const PROXIMAS = [
  ["Fase 2", "Painel, tarefas e fornecedores"],
  ["Fase 3", "Inventário inicial e patrimônio"],
  ["Fase 4", "Financeiro e societário"],
  ["Fase 5", "Estoque"],
  ["Fase 6", "Cardápio, fichas técnicas e POPs"],
  ["Fase 7", "Funcionários, ponto e relatórios"]
];

export async function render(el, { perfil }) {
  const primeiro = esc(perfil.nome.split(" ")[0]);
  el.innerHTML = `
    <div class="card mb-4">
      <h2 class="h2">Olá, ${primeiro}!</h2>
      <p class="text-off/70 mt-1">Você entrou como <b>${esc(PAPEIS[perfil.papel] || perfil.papel)}</b>. A base do sistema está funcionando: login, perfis e regras de segurança.</p>
    </div>
    ${perfil.papel === "admin" ? `
    <div class="card mb-4">
      <h2 class="h2">Próximo passo</h2>
      <p class="text-off/70 mt-1">Abra <a class="underline text-brand" href="#/usuarios">Usuários</a> para cadastrar o outro sócio, o gerente da cozinha e os funcionários.</p>
    </div>` : ""}
    <div class="card">
      <h2 class="h2 mb-2">Próximas fases</h2>
      <ul class="space-y-1">
        ${PROXIMAS.map(([f, t]) => `<li><span class="tag">${f}</span> ${t}</li>`).join("")}
      </ul>
    </div>`;
}
