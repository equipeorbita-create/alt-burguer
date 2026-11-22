import { db, auth } from "../firebase.js";
import { hojeISO } from "../util.js";
import { r3, planoPEPS } from "./estoque-calc.js";
import { bruto } from "./custos.js";
import { collection, doc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// O que a produção consome (somando linhas repetidas e já considerando a perda)
export function necessidades(receita, vezes) {
  const m = new Map();
  for (const l of receita.ingredientes || []) {
    const cur = m.get(l.id) || { id: l.id, tipo: l.tipo, nome: l.nome, unidade: l.unidade, qtd: 0 };
    cur.qtd = r3(cur.qtd + bruto(l) * vezes);
    m.set(l.id, cur);
  }
  return [...m.values()];
}

// Registra a produção de um preparo: baixa os ingredientes (PEPS) e cria o lote do preparo pronto,
// tudo numa transação só (ou acontece tudo, ou nada).
export async function produzir({ receita, vezes, rendimentoReal, validade, lotes, perfil, nomeDe }) {
  const planos = necessidades(receita, vezes).map((n) => ({ n: { ...n, nome: nomeDe(n) || n.nome }, ...planoPEPS(lotes, n.id, n.qtd) }));
  const sem = planos.find((p) => p.falta > 0);
  if (sem) { const e = new Error("FALTA_ITEM"); e.item = sem.n.nome; e.falta = sem.falta; e.unidade = sem.n.unidade; throw e; }
  const rend = r3(rendimentoReal);
  if (!(rend > 0)) throw new Error("QTD_INVALIDA");
  const loteRef = doc(collection(db, "lotes"));
  await runTransaction(db, async (tx) => {
    const usados = [];
    for (const p of planos) for (const x of p.plano) {            // primeiro lê tudo...
      const ref = doc(db, "lotes", x.loteId);
      const atual = (await tx.get(ref)).data().qtdAtual;
      if (atual < x.qtd) throw new Error("ESTOQUE_MUDOU");
      usados.push({ ref, novo: r3(atual - x.qtd) });
    }
    usados.forEach((u) => tx.update(u.ref, { qtdAtual: u.novo })); // ...depois grava
    const base = { por: auth.currentUser.uid, porNome: perfil.nome, motivo: "producao", em: serverTimestamp() };
    planos.forEach((p) => tx.set(doc(collection(db, "movimentacoes")), {
      tipo: "producao", insumoId: p.n.id, insumoNome: p.n.nome, unidade: p.n.unidade, delta: -p.n.qtd, lotes: p.plano,
      obs: `Produção de ${receita.nome} (×${vezes})`, ...base
    }));
    tx.set(loteRef, {
      insumoId: receita.id, qtdInicial: rend, qtdAtual: rend, validade: validade || "", entradaEm: hojeISO(),
      origem: "producao", tipoItem: "preparo", criadoPor: auth.currentUser.uid, criadoEm: serverTimestamp()
    });
    tx.set(doc(collection(db, "movimentacoes")), {
      tipo: "producao", insumoId: receita.id, insumoNome: receita.nome, unidade: receita.unidade, delta: rend,
      lotes: [{ loteId: loteRef.id, qtd: rend }], obs: `Produzido (×${vezes})`, ...base
    });
  });
}
