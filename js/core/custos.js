// Custo em cascata, CMV e margem (funções puras, sem Firebase).
// O custo NUNCA é gravado: é recalculado na hora a partir dos preços atuais dos insumos.
const arred = (n, c = 4) => Math.round(n * 10 ** c) / 10 ** c;

// Quanto sai do estoque para a quantidade pesada, considerando a perda (aparas, cocção etc.)
export const bruto = (l) => l.qtd / (1 - (l.perda || 0) / 100);

export function criarCalc({ insumos, receitas, custos }) {
  const rec = new Map(receitas.map((r) => [r.id, r]));

  function custoUnitario(tipo, id, pilha = []) {
    if (tipo === "insumo") {
      const c = custos[id]?.custoUnitario;
      return c > 0 ? { valor: c } : { valor: null };
    }
    const r = rec.get(id);
    if (!r) return { valor: null };
    if (pilha.includes(id)) return { valor: null, ciclo: true };
    const c = custoReceita(r, pilha);
    return { valor: r.rendimento > 0 ? c.total / r.rendimento : null, incompleto: c.incompleto, ciclo: c.ciclo };
  }

  function custoReceita(r, pilha = []) {
    let total = 0, incompleto = false, ciclo = false;
    for (const l of r.ingredientes || []) {
      const u = custoUnitario(l.tipo, l.id, [...pilha, r.id]);
      if (u.ciclo) ciclo = true;
      if (u.incompleto) incompleto = true;
      if (u.valor == null) incompleto = true; else total += u.valor * bruto(l);
    }
    return { total: arred(total), incompleto, ciclo };
  }

  return {
    custoReceita: (r) => custoReceita(r, []),
    custoUnitario: (tipo, id) => custoUnitario(tipo, id, []),
    // custo de uma linha da ficha (null = insumo sem preço cadastrado)
    custoLinha: (l, receitaId) => { const u = custoUnitario(l.tipo, l.id, [receitaId]); return u.valor == null ? null : arred(u.valor * bruto(l)); }
  };
}

// Uma receita não pode usar a si mesma, direta ou indiretamente (ex.: A usa B e B usa A)
export function temCiclo(receitas, raizId, ingredientes) {
  const rec = new Map(receitas.map((r) => [r.id, r]));
  const visto = new Set();
  const busca = (lista) => (lista || []).some((l) => {
    if (l.tipo !== "preparo") return false;
    if (l.id === raizId) return true;
    if (visto.has(l.id)) return false;
    visto.add(l.id);
    return busca(rec.get(l.id)?.ingredientes);
  });
  return busca(ingredientes);
}

export function indicadores({ custo, preco, meta, taxasPct = 0 }) {
  const ok = preco > 0;
  const cmv = ok ? (custo / preco) * 100 : null;
  return {
    cmv, margem: ok ? preco - custo : null, margemPct: ok ? ((preco - custo) / preco) * 100 : null,
    margemReal: ok ? preco * (1 - taxasPct / 100) - custo : null,
    sugerido: meta > 0 ? custo / (meta / 100) : null,
    situacao: !ok ? "semPreco" : cmv <= meta ? "ok" : cmv <= meta + 5 ? "atencao" : "alto"
  };
}

// 27,45 -> 27,90 (preço "redondo" de cardápio)
export function arredondar90(v) { const b = Math.floor(v); return b + 0.9 >= v ? b + 0.9 : b + 1.9; }

export function fmtQtd(q, un) {
  const f = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
  if (un === "g" && q >= 1000) return `${f(q / 1000)} kg`;
  if (un === "ml" && q >= 1000) return `${f(q / 1000)} l`;
  return `${f(q)} ${un}`;
}
