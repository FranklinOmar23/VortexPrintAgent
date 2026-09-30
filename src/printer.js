// Impresión real: Electron ya trae todo lo necesario, no hace falta ninguna librería externa
// de impresión (ni Puppeteer, ni SumatraPDF, ni ESC/POS a mano).
const { BrowserWindow } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function ejecutarPowerShell(comando) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", comando],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

/**
 * Lista las impresoras que ve el sistema operativo (las mismas que aparecen en
 * "Dispositivos e impresoras" de Windows), con su estado REAL -- cuál es la predeterminada de
 * Windows y cuál está desconectada ahora mismo -- vía WMI (Win32_Printer), no solo el nombre
 * (que era todo lo que traía la versión anterior basada en Electron getPrintersAsync()).
 * @returns {Promise<{name: string, isDefault: boolean, isOffline: boolean, isLocal: boolean}[]>}
 */
async function listPrinters() {
  try {
    const salida = await ejecutarPowerShell(
      "Get-CimInstance Win32_Printer | Select-Object Name,Default,PrinterStatus,WorkOffline,Local | ConvertTo-Json -Compress"
    );
    const texto = salida.trim();
    const parseado = texto ? JSON.parse(texto) : [];
    const lista = Array.isArray(parseado) ? parseado : [parseado];

    return lista
      .filter((p) => p && p.Name)
      .map((p) => ({
        name: p.Name,
        isDefault: Boolean(p.Default),
        // PrinterStatus 7 = "Offline" en Win32_Printer; WorkOffline es el caso en que alguien
        // la puso manualmente en "Usar la impresora sin conexión" desde Windows -- ambos casos
        // significan lo mismo para el cajero: esta impresora no va a imprimir ahora mismo (ej.
        // una térmica USB que se desconectó).
        isOffline: p.WorkOffline === true || p.PrinterStatus === 7,
        isLocal: p.Local !== false,
      }));
  } catch (err) {
    // Fallback si PowerShell/WMI falla por algún motivo (ej. política de ejecución bloqueada) --
    // se usa el método anterior de Electron. Menos preciso (Default/Offline quedan en false por
    // defecto) pero evita dejar la pantalla de Impresoras completamente vacía.
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    try {
      const impresoras = await win.webContents.getPrintersAsync();
      return impresoras.map((p) => ({
        name: p.name,
        isDefault: Boolean(p.isDefault),
        isOffline: false,
        isLocal: true,
      }));
    } finally {
      win.destroy();
    }
  }
}

// Ancho físico real en mm por cada valor de "paperSize" configurado en Configuración > Facturas
// (ver ANCHOS_PAPEL en imprimirFactura.js) -- a diferencia de esos px (que son solo para el
// layout CSS en pantalla, no una medida física), acá se necesita el ancho real de la impresora
// para que Windows/el driver reconozca la página, o el contenido termina renderizado fuera del
// área física de la impresora térmica y no se ve nada.
const ANCHOS_MM = { "57mm": 57, "80mm": 80, A4: 210, carta: 216 };
const MICRONES_POR_MM = 1000;
const MICRONES_POR_PX = 25.4 / 96 * 1000; // 1 px CSS (referencia a 96 DPI) = 264.583 micrones.
// Piso de alto de página -- por si el ticket es muy corto (pocos ítems), para no pasarle a
// Chromium una página absurdamente chica.
const ALTO_MINIMO_MICRONES = 60 * 1000;
// Margen extra sobre el alto medido del documento real, por si el margin/padding del body no
// termina de reflejarse 1:1 en scrollHeight en algún caso límite.
const MARGEN_ALTO_PX = 24;

function calcularAnchoMicrones(paperSize, html) {
  const anchoMm = ANCHOS_MM[paperSize];
  if (anchoMm) return anchoMm * MICRONES_POR_MM;

  // Sin paperSize conocido (ej. llamadas viejas del frontend antes de este cambio) -- se
  // aproxima con el ancho en px del CSS, menos preciso pero mejor que nada.
  const match = html.match(/width:\s*(\d+)px/);
  const anchoPx = match ? Number(match[1]) : 280; // 280px ~= 80mm, mismo default de imprimirFactura.js
  return Math.round(anchoPx * MICRONES_POR_PX);
}

/**
 * Imprime un HTML autocontenido (con su propio <style>, generado por buildFacturaHtml en el
 * frontend) directo a la impresora indicada, sin ningún diálogo.
 * @param {string} printerName - nombre exacto tal como lo devuelve listPrinters()
 * @param {string} html
 * @returns {Promise<void>} rechaza si falla
 */
function imprimirHtml(printerName, html, paperSize) {
  return new Promise((resolve, reject) => {
    // Cargar el ticket desde un archivo temporal en vez de una URL "data:" -- Chromium tiene un
    // bug conocido donde webContents.print() imprime una página en blanco cuando el documento se
    // cargó vía data: URL (la impresora alimenta un poco de papel y corta sin imprimir nada, que
    // es exactamente el síntoma reportado). Con loadFile() el documento se carga como un archivo
    // real y el pipeline de impresión sí lo renderiza.
    const rutaTemporal = path.join(os.tmpdir(), `vortex-print-agent-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(rutaTemporal, html, "utf-8");

    const limpiar = () => {
      fs.unlink(rutaTemporal, () => {});
    };

    // Sin "offscreen" acá -- el renderizado offscreen usa un compositor separado que no se
    // integra bien con el pipeline nativo de impresión de Chromium (mismo síntoma de página en
    // blanco). "show: false" ya es suficiente para que la ventana no se vea.
    const win = new BrowserWindow({ show: false });

    win.webContents.once("did-finish-load", () => {
      // "did-finish-load" solo garantiza que el HTML terminó de cargar, no que Chromium ya
      // pintó/compuso el frame -- si se manda a imprimir de inmediato, a veces el pipeline de
      // impresión captura un frame todavía vacío (mismo síntoma: alimenta un poco de papel y
      // corta sin imprimir nada). Se espera un momento a que el render se asiente antes de imprimir.
      setTimeout(async () => {
        try {
          // Antes esto usaba un alto de página FIJO (200mm) sin importar cuántos ítems tuviera la
          // venta -- una factura larga superaba ese alto y Chromium paginaba el documento en una
          // "página 2", cortando filas de la tabla a la mitad entre ambas páginas (el total de una
          // línea quedaba partido, ej. "315.00" impreso como "3" arriba y el resto perdido). Como
          // una impresora térmica es de rollo continuo, no tiene sentido paginar del todo: se mide
          // el alto REAL del documento ya renderizado y se usa exactamente eso como pageSize.height,
          // así el ticket completo entra en una sola "página" sin importar cuántos productos tenga.
          const altoContenidoPx = await win.webContents.executeJavaScript("document.body.scrollHeight");
          const altoMicrones = Math.max(
            ALTO_MINIMO_MICRONES,
            Math.round((Number(altoContenidoPx) + MARGEN_ALTO_PX) * MICRONES_POR_PX)
          );

          win.webContents.print(
            {
              silent: true,
              deviceName: printerName,
              printBackground: true,
              margins: { marginType: "none" },
              pageSize: { width: calcularAnchoMicrones(paperSize, html), height: altoMicrones },
            },
            (success, errorType) => {
              win.destroy();
              limpiar();
              if (success) resolve();
              else reject(new Error(errorType || "No se pudo imprimir"));
            }
          );
        } catch (err) {
          win.destroy();
          limpiar();
          reject(err);
        }
      }, 500);
    });

    win.webContents.once("did-fail-load", (_event, _code, description) => {
      win.destroy();
      limpiar();
      reject(new Error(description || "No se pudo cargar el ticket"));
    });

    win.loadFile(rutaTemporal);
  });
}

module.exports = { listPrinters, imprimirHtml };
