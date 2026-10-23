// Impresoras en macOS: el sistema de impresión es CUPS, y "lpstat" (viene con macOS) da lo mismo
// que en Windows sacamos de WMI -- el nombre de cada cola, cuál es la predeterminada y cuál está
// deshabilitada. El nombre es el de la cola de CUPS (ej. "EPSON_TM_T20III"), que es el que espera
// webContents.print({ deviceName }).
const { execFile } = require("child_process");

function ejecutar(comando, argumentos) {
  return new Promise((resolve) => {
    // lpstat sale con error si no hay ninguna impresora o ninguna predeterminada: no es un fallo,
    // simplemente no hay datos.
    execFile(comando, argumentos, { maxBuffer: 1024 * 1024, env: { ...process.env, LANG: "C" } }, (_error, stdout) =>
      resolve(stdout || "")
    );
  });
}

/**
 * Interpreta la salida de `lpstat -p` y `lpstat -d` (con LANG=C, en inglés):
 *   printer EPSON_TM_T20III is idle.  enabled since Thu Oct 23 10:00:00 2026
 *   printer Oficina disabled since Thu Oct 23 09:00:00 2026 -
 *   system default destination: EPSON_TM_T20III
 * @returns {{name: string, isDefault: boolean, isOffline: boolean, isLocal: boolean}[]}
 */
function interpretarLpstat(salidaImpresoras, salidaPredeterminada) {
  const predeterminada = /system default destination:\s*(\S+)/.exec(salidaPredeterminada)?.[1] ?? null;

  return salidaImpresoras
    .split(/\r?\n/)
    .map((linea) => /^printer\s+(\S+)\s+(.*)$/.exec(linea.trim()))
    .filter(Boolean)
    .map(([, nombre, resto]) => ({
      name: nombre,
      isDefault: nombre === predeterminada,
      // "disabled" = la cola está pausada en Preferencias del Sistema: no va a imprimir.
      isOffline: /\bdisabled\b/i.test(resto),
      isLocal: true,
    }));
}

async function listarImpresorasMac() {
  const [impresoras, predeterminada] = await Promise.all([ejecutar("lpstat", ["-p"]), ejecutar("lpstat", ["-d"])]);
  return interpretarLpstat(impresoras, predeterminada);
}

module.exports = { interpretarLpstat, listarImpresorasMac };
