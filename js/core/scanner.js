import { carregarScript } from "./scripts.js";

const LIB = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";

// Abre a câmera e devolve o texto lido (QR ou código de barras), ou null se cancelar.
export async function lerCodigo(titulo = "Ler código") {
  await carregarScript(LIB);
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<h2 class="h2 mb-3">${titulo}</h2>
      <div id="leitor"></div>
      <p id="leitorMsg" class="text-sm text-ink/70 mt-3">Abrindo a câmera…</p>
      <div class="flex gap-3 justify-end mt-4"><button type="button" class="btn-alt" id="leitorCancelar">Cancelar</button></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    const F = window.Html5QrcodeSupportedFormats;
    const leitor = new window.Html5Qrcode("leitor", {
      formatsToSupport: [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39],
      verbose: false
    });
    let fim = false;
    const encerrar = async (valor) => {
      if (fim) return;
      fim = true;
      try { await leitor.stop(); } catch (e) { /* câmera já parada */ }
      try { leitor.clear(); } catch (e) { /* nada a limpar */ }
      dlg.close();
      dlg.remove();
      resolve(valor);
    };
    dlg.querySelector("#leitorCancelar").addEventListener("click", () => encerrar(null));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); encerrar(null); });

    leitor.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: (w, h) => { const l = Math.floor(Math.min(w, h) * 0.7); return { width: l, height: l }; } },
      (texto) => encerrar(texto),
      () => {}
    ).then(() => { dlg.querySelector("#leitorMsg").textContent = "Aponte a câmera para o QR ou código de barras."; })
     .catch(() => { dlg.querySelector("#leitorMsg").textContent = "Não foi possível abrir a câmera. Libere a permissão da câmera para este site no navegador e tente de novo."; });
  });
}
