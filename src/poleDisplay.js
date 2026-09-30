// Puente hacia el pole display (pantalla de cliente, normalmente 2 líneas x 20 caracteres) --
// mismo criterio que printer.js: nada de esto pasa por el navegador porque Chrome no puede
// hablarle directo a un puerto serial/COM, así que el agente hace de intermediario.
//
// Protocolo: "CD5220 / Ultimate Technology genérico", el set de comandos que copian la enorme
// mayoría de los pole display USB-a-serial que se venden sueltos para POS (Bixolon, Logic
// Controls, Posiflex y decenas de genéricos sin marca en AliExpress/Amazon todos lo imitan). Si
// tu modelo exacto no responde con esto, ESTA es la única sección que hay que tocar -- el resto
// del archivo (conexión, cola de escritura, manejo de errores) no depende del protocolo.
const ESC = "\x1B";
const CLEAR_Y_HOME = `${ESC}@`; // ESC @ -- borra la pantalla y pone el cursor en la línea 1, columna 1.
const SALTO_LINEA = "\r\n"; // Mueve el cursor a la línea 2, columna 1.

const { SerialPort } = require("serialport");

const ANCHO_LINEA = 20; // caracteres por línea -- el tamaño más común (2x20). Ajustar si el
// display real es de 40 columnas o 4 líneas.
const BAUD_RATE = 9600; // valor de fábrica de la inmensa mayoría de estos displays.

let puertoActual = null; // { path, port: SerialPort }

/**
 * Puertos serial que ve el sistema operativo (COM1, COM2, etc. en Windows) -- para que el
 * frontend le muestre al usuario una lista real en vez de pedirle que adivine el nombre.
 * @returns {Promise<{path: string, manufacturer?: string}[]>}
 */
async function listarPuertos() {
  const puertos = await SerialPort.list();
  return puertos.map((p) => ({ path: p.path, manufacturer: p.manufacturer }));
}

/**
 * Ajusta un texto a exactamente ANCHO_LINEA caracteres -- corta si es muy largo, rellena con
 * espacios si es corto. Sin este relleno, un texto corto en la línea 1 no borra los caracteres
 * que quedaron de un texto más largo mostrado antes en esa misma posición (el display no hace
 * "clear" solo, hay que pisarlo con espacios).
 */
function ajustarLinea(texto) {
  const limpio = String(texto ?? "").slice(0, ANCHO_LINEA);
  return limpio.padEnd(ANCHO_LINEA, " ");
}

/**
 * Abre (o reutiliza, si ya está abierto al mismo puerto) la conexión serial. Se mantiene
 * abierta entre escrituras -- a diferencia de imprimir (un evento puntual por venta), el pole
 * display se actualiza varias veces por segundo mientras se cobra, así que abrir/cerrar el
 * puerto en cada escritura sería no solo más lento sino que muchos displays parpadean o se
 * resetean brevemente cada vez que el puerto se abre.
 * @param {string} portName - ej. "COM3"
 */
function conectar(portName) {
  return new Promise((resolve, reject) => {
    if (puertoActual?.path === portName && puertoActual.port.isOpen) {
      resolve();
      return;
    }

    if (puertoActual) {
      try { puertoActual.port.close(); } catch { /* ya pudo estar cerrado */ }
      puertoActual = null;
    }

    const port = new SerialPort({ path: portName, baudRate: BAUD_RATE }, (error) => {
      if (error) {
        reject(new Error(`No se pudo abrir ${portName}: ${error.message}`));
        return;
      }
      puertoActual = { path: portName, port };
      resolve();
    });

    port.on("error", (error) => {
      // Errores post-apertura (ej. se desconectó el cable a mitad de uso) -- se descarta la
      // conexión para que la próxima escritura la vuelva a abrir en vez de seguir apuntando a
      // un puerto muerto.
      console.error("Error en el puerto del pole display:", error.message);
      puertoActual = null;
    });
  });
}

/**
 * Escribe dos líneas en el display, reemplazando lo que hubiera antes.
 * @param {string} portName
 * @param {string} linea1
 * @param {string} [linea2]
 */
async function escribir(portName, linea1, linea2 = "") {
  await conectar(portName);

  const payload = CLEAR_Y_HOME + ajustarLinea(linea1) + SALTO_LINEA + ajustarLinea(linea2);

  return new Promise((resolve, reject) => {
    puertoActual.port.write(payload, "ascii", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Borra la pantalla (ej. al cerrar sesión o cuando no hay ninguna venta en curso). */
async function limpiar(portName) {
  return escribir(portName, "", "");
}

module.exports = { listarPuertos, escribir, limpiar };
