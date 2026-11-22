import { db } from "../firebase.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Quem bate ponto: funcionários (e o gerente). Sócios não batem ponto.
// Sócio lê todos; gerente só enxerga os funcionários (mais ele mesmo); funcionário não precisa da lista.
export async function carregarEquipe(perfil) {
  if (perfil.papel === "funcionario") return [];
  const col = collection(db, "usuarios");
  const q = perfil.papel === "admin" ? query(col, where("papel", "in", ["funcionario", "gerente"])) : query(col, where("papel", "==", "funcionario"));
  const lista = (await getDocs(q)).docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.ativo);
  if (perfil.papel === "gerente") lista.push({ uid: perfil.uid, nome: perfil.nome, papel: "gerente", ativo: true });
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}
