import { db } from "../firebase.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const r2 = (n) => Math.round(n * 100) / 100;

export const TIPOS = {
  despesa: "Despesa",
  entrada: "Entrada",
  retirada: "Retirada / pró-labore",
  emprestimo: "Empréstimo de sócio",
  reembolso: "Reembolso a sócio",
  pagamento_fatura: "Pagamento de fatura do cartão"
};

// [tipo, nome]. O sócio pode editar depois em Financeiro > Configurações.
export const CATEGORIAS_PADRAO = [
  ["despesa", "Reforma"], ["despesa", "Equipamentos"], ["despesa", "Utensílios"], ["despesa", "Insumos"],
  ["despesa", "Embalagens"], ["despesa", "Marketing"], ["despesa", "Documentação e licenças"],
  ["despesa", "Água, luz e internet"], ["despesa", "Salários e encargos"], ["despesa", "Outros"],
  ["entrada", "Faturamento"], ["entrada", "Outras receitas"],
  ["retirada", "Pró-labore"], ["retirada", "Distribuição de lucros"]
];

export const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Sócios = usuários ativos com papel admin
export async function carregarSocios() {
  const snap = await getDocs(query(collection(db, "usuarios"), where("papel", "==", "admin")));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.ativo)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// Regras de cálculo (uma só fonte de verdade):
//  - Caixa = caixa inicial + empréstimos + entradas - despesas pagas pelo caixa - retiradas - reembolsos
//  - Despesa paga do bolso do sócio NÃO mexe no caixa: vira saldo a devolver a ele
//  - Compra no cartão da empresa NÃO mexe no caixa; o pagamento da fatura (pagamento_fatura) é que tira do caixa
//  - Saldo do sócio = empréstimos + despesas pagas do bolso - reembolsos recebidos
export function resumo(lancs, caixaInicial = 0) {
  let caixa = Number(caixaInicial) || 0;
  const soc = {};
  const tot = { entradas: 0, despesas: 0, retiradas: 0 };
  const s = (id) => soc[id] || (soc[id] = { emprestado: 0, despesasPagas: 0, reembolsado: 0, retiradas: 0 });
  for (const l of lancs) {
    const v = l.valor;
    if (l.tipo === "emprestimo") { caixa += v; s(l.socioId).emprestado += v; }
    else if (l.tipo === "entrada") { caixa += v; tot.entradas += v; }
    else if (l.tipo === "despesa") { tot.despesas += v; if (l.socioId) s(l.socioId).despesasPagas += v; else if (!l.cartaoId) caixa -= v; }   // compra no cartão só sai do caixa quando a fatura é paga
    else if (l.tipo === "pagamento_fatura") caixa -= v;
    else if (l.tipo === "retirada") { caixa -= v; tot.retiradas += v; if (l.socioId) s(l.socioId).retiradas += v; }
    else if (l.tipo === "reembolso") { caixa -= v; s(l.socioId).reembolsado += v; }
  }
  let devedorTotal = 0;
  for (const k in soc) {
    const x = soc[k];
    x.saldo = r2(x.emprestado + x.despesasPagas - x.reembolsado);
    devedorTotal += x.saldo;
  }
  return { caixa: r2(caixa), soc, devedorTotal: r2(devedorTotal), entradas: r2(tot.entradas), despesas: r2(tot.despesas), retiradas: r2(tot.retiradas) };
}
