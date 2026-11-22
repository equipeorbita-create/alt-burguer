// Lógica do ponto (funções puras, sem Firebase). Fuso fixo de Fortaleza (UTC-3, sem horário de verão).
export const TIPOS_PONTO = { entrada: "Entrada", intervalo_inicio: "Início do intervalo", intervalo_fim: "Fim do intervalo", saida: "Saída" };
const FUSO = "America/Fortaleza";

export const diaFortaleza = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: FUSO });
export const horaFortaleza = (ms, seg = false) =>
  new Date(ms).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", ...(seg ? { second: "2-digit" } : {}), hour12: false });
export const mesAtual = () => diaFortaleza(Date.now()).slice(0, 7);
export const inicioMesMs = (mes) => Date.parse(`${mes}-01T00:00:00-03:00`);
export const fimMesMs = (mes) => { const [a, m] = mes.split("-").map(Number); return Date.parse(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00-03:00`); };

export function fmtHoras(seg) {
  if (seg == null) return "—";
  const m = Math.round(seg / 60);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// O que a pessoa pode registrar agora, olhando só o ÚLTIMO registro (serve para turno que passa da meia-noite).
// Se o turno anterior ficou aberto há mais de 16 h (esqueceu a saída), também permite iniciar novo turno.
export function proximosTipos(ultimo, agoraMs, limiteHoras = 16) {
  if (!ultimo || ultimo.tipo === "saida") return ["entrada"];
  const velho = agoraMs - ultimo.ms > limiteHoras * 3600e3;
  const base = { entrada: ["intervalo_inicio", "saida"], intervalo_inicio: ["intervalo_fim"], intervalo_fim: ["saida"] }[ultimo.tipo] || ["entrada"];
  return velho ? [...base, "entrada"] : base;
}

export const situacao = (ultimo, agoraMs) => {
  if (!ultimo || ultimo.tipo === "saida") return "fora";
  if (agoraMs - ultimo.ms > 16 * 3600e3) return "esquecido";
  return ultimo.tipo === "intervalo_inicio" ? "intervalo" : "trabalhando";
};

// registros em ordem crescente: [{tipo, ms}] -> turnos. O turno pertence ao dia da entrada.
export function agruparTurnos(registros) {
  const regs = [...registros].sort((a, b) => a.ms - b.ms), turnos = [];
  let t = null;
  const fecha = (incompleto) => { t.incompleto = incompleto; if (incompleto) t.segundos = null; turnos.push(t); t = null; };
  for (const r of regs) {
    if (r.tipo === "entrada") {
      if (t) fecha(true);
      t = { dia: diaFortaleza(r.ms), inicio: r.ms, fim: null, segundos: null, intervalo: 0, interIni: null, regs: [r], incompleto: false };
    } else if (!t) {
      turnos.push({ dia: diaFortaleza(r.ms), inicio: null, fim: null, segundos: null, incompleto: true, orfao: true, regs: [r] });
    } else {
      t.regs.push(r);
      if (r.tipo === "intervalo_inicio") t.interIni = r.ms;
      else if (r.tipo === "intervalo_fim" && t.interIni) { t.intervalo += (r.ms - t.interIni) / 1000; t.interIni = null; }
      else if (r.tipo === "saida") { t.fim = r.ms; t.segundos = Math.max(0, (r.ms - t.inicio) / 1000 - t.intervalo); t.incompleto = false; turnos.push(t); t = null; }
    }
  }
  if (t) { t.aberto = true; fecha(true); }
  return turnos;
}

export const totalSegundos = (turnos) => turnos.reduce((s, t) => s + (t.segundos || 0), 0);
