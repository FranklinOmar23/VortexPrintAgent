const { app, Tray, Menu, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const AutoLaunch = require("auto-launch");

const { loadConfig, getConfigPath } = require("./config");
const { getOrCreateCert } = require("./tls");
const printer = require("./printer");
const poleDisplay = require("./poleDisplay");
const balanza = require("./balanza");
const { mostrarVentanaEstado } = require("./ventanaEstado");

// Un solo proceso a la vez -- si alguien abre el agente dos veces (ej. quedó uno corriendo de
// un turno anterior), la segunda instancia simplemente se cierra en vez de pelear por el mismo
// puerto de WebSocket.
const soloInstancia = app.requestSingleInstanceLock();
if (!soloInstancia) {
  app.quit();
}

let tray = null;
let config = null;
let impresorasDetectadas = [];
// Para diagnosticar "Agente inactivo" sin adivinar: qué página se conectó por última vez y cuál
// fue rechazada (origen fuera de allowedOrigins). Se muestran en la bandeja y en la ventana.
let ultimaConexion = null; // { origin, fecha }
let ultimoRechazo = null; // { origin, fecha }

function urlAgente() {
  return `https://127.0.0.1:${config.port}/`;
}

function estadoParaVentana() {
  return {
    version: app.getVersion(),
    impresoras: impresorasDetectadas.length,
    ultimaConexion,
    ultimoRechazo,
  };
}

function abrirVentanaEstado() {
  mostrarVentanaEstado(estadoParaVentana());
}

// La ventana de estado se abre sola la primera vez que corre CADA versión (justo después de
// instalar o actualizar) -- así el paso siguiente queda a la vista en vez de escondido en la
// bandeja.
function esPrimeraVezDeEstaVersion() {
  const marca = path.join(app.getPath("userData"), "version-mostrada.txt");
  try {
    if (fs.readFileSync(marca, "utf-8").trim() === app.getVersion()) return false;
  } catch {
    // No existe todavía.
  }
  try {
    fs.mkdirSync(path.dirname(marca), { recursive: true });
    fs.writeFileSync(marca, app.getVersion());
  } catch {
    // Sin permiso de escritura -- se mostraría en cada arranque, mejor que nunca.
  }
  return true;
}

function iconoBandeja() {
  const rutaIcono = path.join(__dirname, "..", "build", "icon.ico");
  if (fs.existsSync(rutaIcono)) return nativeImage.createFromPath(rutaIcono);
  // Fallback para desarrollo si todavía no se agregó un ícono real antes de empaquetar.
  return nativeImage.createEmpty();
}

function actualizarMenuBandeja() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Vortex Print Agent ${app.getVersion()} -- activo`, enabled: false },
      { label: `Impresoras detectadas: ${impresorasDetectadas.length}`, enabled: false },
      {
        label: ultimaConexion ? `Conectado con: ${ultimaConexion.origin}` : "Ninguna página del sistema conectada todavía",
        enabled: false,
      },
      ...(ultimoRechazo
        ? [{ label: `Rechazada: ${ultimoRechazo.origin || "(sin origen)"} -- ver "Estado y ayuda"`, enabled: false }]
        : []),
      { type: "separator" },
      { label: "Estado y ayuda", click: abrirVentanaEstado },
      {
        // Solo para versiones viejas del sistema, que todavía se conectan por wss:// (el frontend
        // actual usa ws:// y no necesita certificado). Ojo: abre el navegador PREDETERMINADO de
        // Windows -- si el sistema se usa en otro navegador, ahí hay que abrir esta URL a mano.
        label: "Aceptar certificado (solo versiones anteriores del sistema)",
        click: () => shell.openExternal(urlAgente()),
      },
      { type: "separator" },
      {
        label: "Ver impresoras detectadas",
        click: () => {
          dialog.showMessageBox({
            type: "info",
            title: "Impresoras detectadas",
            message: impresorasDetectadas.length
              ? impresorasDetectadas
                  .map((p) => `${p.name}${p.isDefault ? " (predeterminada)" : ""}${p.isOffline ? " -- desconectada" : ""}`)
                  .join("\n")
              : "Ninguna todavía -- se actualiza cuando el frontend pide la lista.",
          });
        },
      },
      {
        label: "Abrir carpeta de configuración",
        click: () => require("electron").shell.showItemInFolder(getConfigPath()),
      },
      { type: "separator" },
      { label: "Salir", click: () => app.quit() },
    ])
  );
}

// Un patrón puede ser un origen exacto ("http://localhost:3000") o traer un "*" como comodín de
// UN solo nivel de subdominio ("https://*.vortex-pos.com" -- cubre cualquier empresa, pero no
// "a.b.vortex-pos.com" de dos niveles, a propósito, para no aflojar el chequeo más de lo
// necesario). Antes esto era un .includes() de igualdad exacta -- con el esquema de un
// subdominio por empresa, NINGÚN cliente nuevo iba a calzar nunca contra la lista fija de
// antes (pensada para una sola IP/host), así que el agente les habría rechazado la conexión a
// todos.
function coincideOrigen(patron, origin) {
  if (!patron.includes("*")) return patron === origin;
  const regexTexto = patron.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? "[a-z0-9-]+" : `\\${c}`));
  return new RegExp(`^${regexTexto}$`, "i").test(origin);
}

function origenPermitido(origin) {
  return config.allowedOrigins.some((patron) => coincideOrigen(patron, origin));
}

function manejarMensaje(ws, data) {
  let mensaje;
  try {
    mensaje = JSON.parse(data.toString());
  } catch {
    ws.send(JSON.stringify({ success: false, error: "Mensaje inválido (no es JSON)." }));
    return;
  }

  if (mensaje.action === "ping") {
    // Chequeo de vida barato -- no enumera impresoras, solo confirma que el agente responde.
    ws.send(JSON.stringify({ success: true }));
    return;
  }

  if (mensaje.action === "listPrinters") {
    printer
      .listPrinters()
      .then((impresoras) => {
        impresorasDetectadas = impresoras;
        actualizarMenuBandeja();
        ws.send(JSON.stringify({ success: true, printers: impresoras }));
      })
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  if (mensaje.action === "print") {
    if (typeof mensaje.html !== "string" || !mensaje.html.trim()) {
      ws.send(JSON.stringify({ success: false, error: "El ticket a imprimir viene vacío." }));
      return;
    }
    printer
      .imprimirHtml(mensaje.printerName, mensaje.html, mensaje.paperSize)
      .then(() => ws.send(JSON.stringify({ success: true })))
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  if (mensaje.action === "listSerialPorts") {
    poleDisplay
      .listarPuertos()
      .then((puertos) => ws.send(JSON.stringify({ success: true, ports: puertos })))
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  if (mensaje.action === "poleDisplayWrite") {
    poleDisplay
      .escribir(mensaje.portName, mensaje.linea1, mensaje.linea2)
      .then(() => ws.send(JSON.stringify({ success: true })))
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  // Balanza (báscula) por puerto serie: devuelve { peso (kg), unidad, estable, crudo }.
  if (mensaje.action === "leerBalanza") {
    balanza
      .leerPeso(mensaje.config)
      .then((lectura) => ws.send(JSON.stringify({ success: true, ...lectura })))
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  if (mensaje.action === "poleDisplayClear") {
    poleDisplay
      .limpiar(mensaje.portName)
      .then(() => ws.send(JSON.stringify({ success: true })))
      .catch((error) => ws.send(JSON.stringify({ success: false, error: error.message })));
    return;
  }

  ws.send(JSON.stringify({ success: false, error: `Acción desconocida: ${mensaje.action}` }));
}

// Página que ve el usuario al visitar https://127.0.0.1:<puerto> directo (por el ítem del menú
// "Aceptar certificado..." o a mano) -- esa visita ES el paso de "aceptar la advertencia de
// sitio no seguro" que el navegador exige una vez por PC antes de dejar pasar el wss:// del
// frontend. No hace falta que muestre nada más que confirmar que va bien.
function paginaEstado() {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Vortex Print Agent</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
  <h1>Vortex Print Agent está activo ✓</h1>
  <p>Ya puedes cerrar esta pestaña. Esto solo hace falta abrirlo una vez por PC -- es lo que le
  confirma al navegador que puede confiar en la conexión segura hacia este agente.</p>
</body>
</html>`;
}

// Monta el WebSocket del agente sobre un servidor HTTP(S) ya creado y lo pone a escuchar SOLO en
// la propia PC. Antes escuchaba en TODAS las interfaces: cualquier equipo de la red local podía
// conectarse -- el chequeo de Origin solo protege contra páginas web en un navegador, un programa
// cualquiera manda el Origin que quiera -- y mandar a imprimir o escribir en el pole display.
function montarWebSocket(servidor, puerto, descripcion) {
  servidor.on("error", (error) => {
    dialog.showErrorBox(
      "Vortex Print Agent",
      `No se pudo iniciar el servidor ${descripcion} en el puerto ${puerto}: ${error.message}\n\n` +
        `Puede que ya haya otra instancia corriendo, o que el puerto esté ocupado por otro programa.`
    );
  });

  const wss = new WebSocket.Server({
    server: servidor,
    // Verifica el Origin ANTES de completar el handshake -- un origen no permitido nunca llega
    // a conectar (no hay ningún diálogo de "¿permitir?" para los orígenes que sí están en la
    // lista: se aceptan directo).
    verifyClient: (info) => {
      const permitido = origenPermitido(info.origin);
      if (!permitido) {
        ultimoRechazo = { origin: info.origin, fecha: new Date().toISOString() };
        actualizarMenuBandeja();
      }
      return permitido;
    },
    // Un ticket HTML (con el logo en base64) pesa decenas de KB; el default de `ws` es 100 MB.
    maxPayload: 5 * 1024 * 1024,
  });

  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin;
    if (ultimaConexion?.origin !== origin) {
      ultimaConexion = { origin, fecha: new Date().toISOString() };
      actualizarMenuBandeja();
    } else {
      ultimaConexion.fecha = new Date().toISOString();
    }
    ws.on("message", (data) => manejarMensaje(ws, data));
  });

  servidor.listen(puerto, "127.0.0.1");
}

function iniciarServidores() {
  const responderEstado = (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(paginaEstado());
  };

  // ws:// sin certificado -- el que usa el frontend actual. Chrome/Edge/Brave/Firefox permiten
  // ws://127.0.0.1 desde una página https (la propia PC cuenta como origen seguro; verificado con
  // Chrome 155), así que el usuario ya no tiene que aceptar ningún certificado. Antes TODO pasaba
  // por wss:// con un certificado autofirmado: había que aceptarlo a mano en el navegador, el menú
  // lo abría en el navegador PREDETERMINADO (que no siempre es donde se usa el POS) y el frontend
  // marcaba "Agente inactivo" aunque el agente estuviera corriendo.
  montarWebSocket(http.createServer(responderEstado), config.portWs, "ws://");

  // wss:// con certificado autofirmado -- solo para frontends viejos (PWA en caché) que todavía
  // se conectan por acá.
  const { cert, key } = getOrCreateCert();
  montarWebSocket(https.createServer({ cert, key }, responderEstado), config.port, "wss://");
}

// Volver a abrir el agente (menú Inicio, acceso directo) cuando ya está corriendo: antes no pasaba
// nada visible y parecía que no había abierto. Ahora muestra la ventana de estado.
app.on("second-instance", () => {
  if (config) abrirVentanaEstado();
});

app.whenReady().then(() => {
  if (!soloInstancia) return;

  // En macOS/Linux no hace falta esta ventana en el dock -- es un agente de bandeja, no una app
  // con ventana visible.
  if (app.dock) app.dock.hide();

  config = loadConfig();
  iniciarServidores();

  tray = new Tray(iconoBandeja());
  tray.setToolTip("Vortex Print Agent -- activo");
  tray.on("click", abrirVentanaEstado);
  actualizarMenuBandeja();

  // Antes "Impresoras detectadas" quedaba en 0 hasta que el sistema pidiera la lista; se carga ya.
  printer
    .listPrinters()
    .then((impresoras) => {
      impresorasDetectadas = impresoras;
      actualizarMenuBandeja();
    })
    .catch(() => {})
    .finally(() => {
      if (esPrimeraVezDeEstaVersion()) abrirVentanaEstado();
    });

  const autoLaunch = new AutoLaunch({ name: "Vortex Print Agent" });
  autoLaunch.isEnabled().then((habilitado) => {
    if (!habilitado) autoLaunch.enable().catch(() => {});
  });
});

// El agente vive en la bandeja -- cerrar todas las ventanas (las ocultas de impresión) no debe
// cerrar la app entera.
app.on("window-all-closed", (event) => event.preventDefault());
