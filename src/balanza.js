// Puente hacia la balanza (báscula) conectada por puerto serie/USB-serie -- mismo criterio que
// poleDisplay.js: Chrome no puede leer un puerto COM, así que el agente hace de intermediario y le
// devuelve el peso al POS.
//
// Dos modos, según la balanza:
//   "continuo": la balanza transmite el peso todo el tiempo; se escucha un momento y se toma la
//               última lectura estable.
//   "W" | "P" | "ENQ": se manda ese comando y se espera la respuesta.
// La interpretación de cada trama está en balanzaParser.js.

const { SerialPort } = require("serialport");
const { ultimaLectura, COMANDOS } = require("./balanzaParser");

const ESPERA_MS = 1500; // tiempo máximo esperando una lectura

let puertoActual = null; // { clave, port }
let cola = Promise.resolve();

// Una lectura a la vez: el POS puede pedir peso dos veces seguidas (doble click, escáner).
function enCola(tarea) {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.catch(() => {});
  return resultado;
}

function normalizarConfig(config = {}) {
  return {
    portName: config.portName,
    baudRate: Number(config.baudRate) || 9600,
    dataBits: [7, 8].includes(Number(config.dataBits)) ? Number(config.dataBits) : 8,
    parity: ["none", "even", "odd"].includes(config.parity) ? config.parity : "none",
    stopBits: [1, 2].includes(Number(config.stopBits)) ? Number(config.stopBits) : 1,
    modo: ["continuo", "W", "P", "ENQ"].includes(config.modo) ? config.modo : "continuo",
  };
}

function conectar(cfg) {
  const clave = `${cfg.portName}|${cfg.baudRate}|${cfg.dataBits}|${cfg.parity}|${cfg.stopBits}`;
  return new Promise((resolve, reject) => {
    if (puertoActual?.clave === clave && puertoActual.port.isOpen) {
      resolve(puertoActual.port);
      return;
    }
    if (puertoActual) {
      try { puertoActual.port.close(); } catch { /* ya pudo estar cerrado */ }
      puertoActual = null;
    }
    const port = new SerialPort(
      { path: cfg.portName, baudRate: cfg.baudRate, dataBits: cfg.dataBits, parity: cfg.parity, stopBits: cfg.stopBits },
      (error) => {
        if (error) {
          reject(new Error(`No se pudo abrir ${cfg.portName}: ${error.message}`));
          return;
        }
        puertoActual = { clave, port };
        resolve(port);
      }
    );
    port.on("error", (error) => {
      console.error("Error en el puerto de la balanza:", error.message);
      puertoActual = null;
    });
  });
}

/**
 * Lee el peso actual.
 * @param {object} config - { portName, baudRate, dataBits, parity, stopBits, modo }
 * @returns {Promise<{ peso: number, unidad: string, estable: boolean, crudo: string }>}
 */
function leerPeso(config) {
  const cfg = normalizarConfig(config);
  if (!cfg.portName) return Promise.reject(new Error("No hay ningún puerto de balanza configurado."));

  return enCola(async () => {
    const port = await conectar(cfg);

    return new Promise((resolve, reject) => {
      let acumulado = "";
      let terminado = false;

      const terminar = (fn) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timer);
        port.off("data", alRecibir);
        fn();
      };

      const alRecibir = (chunk) => {
        acumulado += chunk.toString("latin1");
        if (acumulado.length > 4096) acumulado = acumulado.slice(-1024);
        const lectura = ultimaLectura(acumulado);
        // En modo solicitud, la primera respuesta completa basta; en continuo, se espera una estable.
        if (lectura && (cfg.modo !== "continuo" || lectura.estable) && /[\r\n\x03]/.test(acumulado)) {
          terminar(() => resolve(lectura));
        }
      };

      const timer = setTimeout(() => {
        const lectura = ultimaLectura(acumulado);
        terminar(() =>
          lectura
            ? resolve(lectura)
            : reject(new Error(
                acumulado
                  ? `La balanza respondió algo que no se pudo interpretar: "${acumulado.slice(0, 60)}".`
                  : "La balanza no respondió. Revisa el puerto, la velocidad (baudios) y el modo de lectura."
              ))
        );
      }, ESPERA_MS);

      port.on("data", alRecibir);

      if (cfg.modo !== "continuo") {
        port.write(COMANDOS[cfg.modo], "latin1", (error) => {
          if (error) terminar(() => reject(new Error(`No se pudo pedir el peso: ${error.message}`)));
        });
      }
    });
  });
}

module.exports = { leerPeso };
