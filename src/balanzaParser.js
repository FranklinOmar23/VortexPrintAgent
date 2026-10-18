// Interpretación de lo que manda una balanza por el puerto serie. Separado de balanza.js (que
// abre el puerto) para poder probarlo sin hardware -- ver test/balanzaParser.test.js.
//
// Las balanzas de mostrador mandan texto ASCII con el peso, a veces con prefijos de estado. Formatos
// reales que cubre esto:
//   CAS (PD-II, AP, ER):   "ST,GS,+  1.234kg"   / "US,GS,+  1.230kg"  (ST = estable, US = inestable)
//   Torrey / genéricas:    "   1.234 kg"        / "1.234"
//   Mettler Toledo 8217:   "\x0201.234\r"       (respuesta al comando "W"; "?" en el estado = inestable)
//   Dibal / Epelsa:        "P   1.234"
// Si el modelo usa otro formato, esta función es lo único que hay que adaptar.

const SEPARADOR_TRAMAS = /[\r\n\x03]+/;
const NUMERO_CON_UNIDAD = /([-+]?)\s*(\d+(?:[.,]\d+)?)\s*(kg|lb|g|oz)?/i;

/**
 * @param {string} trama - una línea recibida de la balanza
 * @returns {{ peso: number, unidad: string, estable: boolean, crudo: string } | null}
 */
function interpretarTrama(trama) {
  const crudo = String(trama ?? "");
  const texto = crudo.replace(/[\x00-\x1F]/g, " ").trim();
  if (!texto) return null;

  const m = NUMERO_CON_UNIDAD.exec(texto);
  if (!m) return null;

  const negativo = m[1] === "-";
  let peso = Number(m[2].replace(",", "."));
  if (!Number.isFinite(peso)) return null;
  if (negativo) peso = -peso;

  let unidad = (m[3] || "kg").toLowerCase();
  // Todo se devuelve en kg (la unidad con que se venden los productos por peso en el POS).
  if (unidad === "g") { peso /= 1000; unidad = "kg"; }
  else if (unidad === "lb") { peso *= 0.45359237; unidad = "kg"; }
  else if (unidad === "oz") { peso *= 0.028349523125; unidad = "kg"; }

  const mayus = texto.toUpperCase();
  const inestable = mayus.startsWith("US") || mayus.includes(",US,") || mayus.includes("?") || mayus.includes("MOTION");
  const sobrecarga = mayus.startsWith("OL") || mayus.includes(",OL,");

  return {
    peso: Math.round(peso * 1000) / 1000,
    unidad,
    estable: !inestable && !sobrecarga && !negativo,
    crudo,
  };
}

/**
 * De todo lo acumulado, la última lectura completa (las balanzas en modo continuo mandan varias
 * por segundo; la última es la vigente). Prefiere la última ESTABLE si hay alguna.
 * @param {string} acumulado
 */
function ultimaLectura(acumulado) {
  const tramas = String(acumulado ?? "").split(SEPARADOR_TRAMAS).map(interpretarTrama).filter(Boolean);
  if (tramas.length === 0) return null;
  const estables = tramas.filter((t) => t.estable);
  return estables.length > 0 ? estables[estables.length - 1] : tramas[tramas.length - 1];
}

// Comando que pide el peso en modo "por solicitud". La mayoría de balanzas con comando usan "W"
// (Mettler Toledo/Torrey/genéricas); algunas CAS usan "P" o ENQ (0x05).
const COMANDOS = {
  W: "W\r\n",
  P: "P\r\n",
  ENQ: "\x05",
};

module.exports = { interpretarTrama, ultimaLectura, COMANDOS };
