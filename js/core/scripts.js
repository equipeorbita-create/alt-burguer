// Carrega uma biblioteca externa só quando precisa (deixa o resto do sistema leve).
const cache = new Map();
export function carregarScript(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((ok, falhou) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = ok;
      s.onerror = () => { cache.delete(url); falhou(new Error("SCRIPT_FALHOU")); };
      document.head.appendChild(s);
    }));
  }
  return cache.get(url);
}
