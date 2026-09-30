// tls.js
// Genera (una sola vez por PC) y reutiliza un certificado autofirmado para que el agente hable
// wss:// en vez de ws://. Chrome bloquea SIN EXCEPCIÓN cualquier WebSocket sin cifrar (ws://)
// abierto desde una página https:// -- incluso hacia 127.0.0.1. No es un tema de configuración
// nuestra ni algo que se pueda permitir desde el navegador: es una regla fija de "contenido
// mixto". La única forma de mantener la misma arquitectura (el navegador conectándose directo
// al agente de su propia PC) es que el agente cifre esa conexión.
//
// El certificado se guarda en la carpeta de datos de usuario (junto a config.json, ver
// config.js) para reusarse entre reinicios. Si se regenerara en cada arranque, el navegador
// trataría cada reinicio como un certificado nuevo y el usuario tendría que aceptar la
// advertencia de "sitio no seguro" de nuevo cada vez -- generándolo una sola vez y
// persistiéndolo, esa aceptación dura (en la práctica) mientras no se reinstale el agente.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const selfsigned = require("selfsigned");

function getTlsDir() {
  return path.join(app.getPath("userData"), "tls");
}

function generarCertificado() {
  const attrs = [{ name: "commonName", value: "127.0.0.1" }];
  const pems = selfsigned.generate(attrs, {
    days: 3650, // 10 años -- evita que el certificado expire y fuerce re-aceptarlo sin avisar.
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" }, // DNS
          // Chrome exige un SAN de tipo IP para URLs por IP como "https://127.0.0.1:..." -- el
          // CommonName solo (la forma vieja) ya no alcanza en navegadores modernos.
          { type: 7, ip: "127.0.0.1" },
          { type: 7, ip: "::1" },
        ],
      },
    ],
  });
  return { cert: pems.cert, key: pems.private };
}

/**
 * @returns {{ cert: string, key: string }} PEM del certificado y la llave privada, listos para
 *   pasarle a https.createServer(). Crea el par la primera vez que se llama; después siempre
 *   devuelve el mismo (leído de disco).
 */
function getOrCreateCert() {
  const dir = getTlsDir();
  const certPath = path.join(dir, "cert.pem");
  const keyPath = path.join(dir, "key.pem");

  try {
    return {
      cert: fs.readFileSync(certPath, "utf-8"),
      key: fs.readFileSync(keyPath, "utf-8"),
    };
  } catch {
    // No existe todavía (primera vez) o está corrupto/incompleto -- se genera de nuevo.
    const { cert, key } = generarCertificado();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(certPath, cert);
    fs.writeFileSync(keyPath, key);
    return { cert, key };
  }
}

module.exports = { getOrCreateCert, getTlsDir };
