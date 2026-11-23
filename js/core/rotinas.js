// Agenda das rotinas (funções puras): diária, semanal, mensal e "a cada N dias".
export const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const entreDias = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
export const somaDias = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const diaSemana = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
export const execId = (rotinaId, data) => `${rotinaId}_${data}`;

// ultima = data (AAAA-MM-DD) da última vez em que a rotina foi CONCLUÍDA (só importa para "a cada N dias")
export function statusRotina(r, hoje, ultima = null) {
  const rec = r.recorrencia || {};
  if (r.ativo === false) return { devida: false };
  if (rec.inicio && hoje < rec.inicio) return { devida: false };
  switch (rec.tipo) {
    case "diaria": return { devida: true };
    case "semanal": return { devida: (rec.dias || []).includes(diaSemana(hoje)) };
    case "mensal": return { devida: Number(hoje.slice(8, 10)) === (rec.diaMes || 1) };
    case "intervalo": {
      const n = Math.max(1, rec.cada || 15), prox = ultima ? somaDias(ultima, n) : (rec.inicio || hoje), atraso = entreDias(prox, hoje);
      return { devida: atraso >= 0, atrasada: atraso > 0, diasAtraso: Math.max(0, atraso), proxima: prox };
    }
    default: return { devida: false };
  }
}

export const paraMim = (r, { papel, uid }) => (r.paraPapeis || []).includes(papel) || (r.paraUids || []).includes(uid);
export const progresso = (itens = []) => ({ feitos: itens.filter((i) => i.feito).length, total: itens.length });

export function descreverRecorrencia(rec = {}) {
  if (rec.tipo === "diaria") return "Todos os dias";
  if (rec.tipo === "semanal") return "Toda " + (rec.dias || []).map((d) => DIAS[d]).join(", ");
  if (rec.tipo === "mensal") return `Todo dia ${rec.diaMes || 1} do mês`;
  if (rec.tipo === "intervalo") return `A cada ${rec.cada || 15} dias`;
  return "—";
}
