// Carrega do banco as entradas que vêm do fechamento diário e dos recebimentos, para entrarem na conta do caixa.
import { db } from "../firebase.js";
import { entradasSinteticas } from "./caixa.js";
import { collection, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ver = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));

// Só sócios (os dados do fechamento ficam restritos a eles). cb recebe a lista de entradas sempre que algo muda.
export function assinarEntradas(cb, onErro = console.error) {
  let f = [], r = [];
  const emite = () => cb(entradasSinteticas(f, r));
  const a = onSnapshot(collection(db, "fechamentos"), (s) => { f = ver(s); emite(); }, onErro);
  const b = onSnapshot(collection(db, "recebiveis"), (s) => { r = ver(s); emite(); }, onErro);
  return () => { a(); b(); };
}
export async function carregarEntradas() {
  const [f, r] = await Promise.all([getDocs(collection(db, "fechamentos")), getDocs(collection(db, "recebiveis"))]);
  return entradasSinteticas(ver(f), ver(r));
}
