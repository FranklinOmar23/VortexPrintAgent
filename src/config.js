// Config editable en disco -- puerto del WebSocket y orígenes del frontend que se aceptan sin
// pedir permiso. Se guarda en la carpeta de datos de usuario de la app (no junto al .exe
// instalado, porque Program Files normalmente no es escribible sin admin) para que sea fácil de
// editar a mano si hace falta agregar un origen nuevo (ej. una URL de producción distinta).
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULTS = {
  // wss:// con certificado autofirmado -- solo para frontends viejos que todavía lo usan (exige
  // aceptar el certificado en el navegador).
  port: 56789,
  // ws:// sin TLS -- el que usa el frontend actual. Desde una página https, Chrome/Edge/Brave/
  // Firefox permiten ws://127.0.0.1 (la propia PC cuenta como origen seguro), así que no hace
  // falta ningún certificado.
  portWs: 56790,
  allowedOrigins: [
    "http://localhost:5173",
    "http://localhost:3000",
    // IP de la infraestructura anterior (backend + frontend detrás del mismo proxy) -- se deja
    // por compatibilidad con instalaciones que todavía apunten ahí.
    "http://192.168.4.134",
    "https://192.168.4.134",
    // Esquema nuevo: un subdominio por empresa (ej. "arcodedominicana.vortex-pos.com"). Un solo
    // patrón con comodín cubre TODAS las empresas sin tener que agregar cada subdominio a mano
    // acá (ver origenPermitido() en main.js, que interpreta el "*"). Si el dominio real termina
    // siendo otro, hay que actualizarlo acá o a mano en config.json (ver "Abrir carpeta de
    // configuración" en el menú de la bandeja).
    "https://*.vortex-pos.com",
    "https://vortex-pos.com",
  ],
};

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const guardada = JSON.parse(raw);
    // allowedOrigins se UNE con los defaults en vez de reemplazarlos: config.json se crea una sola
    // vez (con los defaults de ESA versión), así que antes un origen agregado a DEFAULTS en una
    // versión nueva nunca llegaba a las PCs ya instaladas -- el agente las rechazaba en silencio.
    const origenesGuardados = Array.isArray(guardada.allowedOrigins) ? guardada.allowedOrigins : [];
    return {
      ...DEFAULTS,
      ...guardada,
      allowedOrigins: [...new Set([...DEFAULTS.allowedOrigins, ...origenesGuardados])],
    };
  } catch {
    // Primera vez que corre, o el archivo no existe/está corrupto -- se crea con los defaults.
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, getConfigPath };
