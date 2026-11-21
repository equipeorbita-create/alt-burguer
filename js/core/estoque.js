import { db, auth } from "../firebase.js";
import { hojeISO } from "../util.js";
import { r3, estoqueDe, planoPEPS } from "./estoque-calc.js";
import {
  collection, doc, runTransaction, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export * from "./estoque-calc.js";

const movimento = (insumo, tipo, delta, plano, motivo, obs, perfil) => ({
  tipo, insumoId: insumo.id, insumoNome: insumo.nome, unidade: insumo.unidade, delta: r3(delta), lotes: plano,
  motivo: motivo || "", obs: obs || "", por: auth.currentUser.uid, porNome: perfil.nome, em: serverTimestamp()
});

// Saída de estoque pelo método PEPS. Roda em transação: se outra pessoa mexer no mesmo lote
// ao mesmo tempo, a operação é refeita com segurança em vez de gerar saldo errado.
export async function baixarPEPS({ insumo, qtd, tipo = "baixa", motivo = "", obs = "", perfil, lotes }) {
  qtd = r3(qtd);
  if (!(qtd > 0)) throw new Error("QTD_INVALIDA");
  const { plano, falta } = planoPEPS(lotes, insumo.id, qtd);
  if (falta > 0) throw new Error("SEM_ESTOQUE");
  const movRef = doc(collection(db, "movimentacoes"));
  await runTransaction(db, async (tx) => {
    const usados = [];
    for (const p of plano) {                       // primeiro lê tudo...
      const ref = doc(db, "lotes", p.loteId);
      const atual = (await tx.get(ref)).data().qtdAtual;
      if (atual < p.qtd) throw new Error("ESTOQUE_MUDOU");
      usados.push({ ref, novo: r3(atual - p.qtd) });
    }
    usados.forEach((u) => tx.update(u.ref, { qtdAtual: u.novo }));   // ...depois grava
    tx.set(movRef, movimento(insumo, tipo, -qtd, plano, motivo, obs, perfil));
  });
}

// Contagem física: compara o que existe com o que o sistema diz e corrige a diferença.
export async function ajustarContagem({ insumo, contado, obs, perfil, lotes }) {
  const sistema = estoqueDe(lotes, insumo.id);
  const dif = r3(contado - sistema);
  if (dif === 0) return 0;
  const texto = `Contagem: sistema ${sistema}, contado ${contado}${obs ? ". " + obs : ""}`;
  if (dif < 0) {
    await baixarPEPS({ insumo, qtd: -dif, tipo: "ajuste", motivo: "contagem", obs: texto, perfil, lotes });
  } else {
    const lote = writeBatch(db);
    const loteRef = doc(collection(db, "lotes"));
    lote.set(loteRef, {
      insumoId: insumo.id, qtdInicial: dif, qtdAtual: dif, validade: "", entradaEm: hojeISO(), origem: "ajuste",
      criadoPor: auth.currentUser.uid, criadoEm: serverTimestamp()
    });
    lote.set(doc(collection(db, "movimentacoes")), movimento(insumo, "ajuste", dif, [{ loteId: loteRef.id, qtd: dif }], "contagem", texto, perfil));
    await lote.commit();
  }
  return dif;
}
