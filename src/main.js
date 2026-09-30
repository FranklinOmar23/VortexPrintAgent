const { app, Tray, Menu, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const WebSocket = require("ws");
const AutoLaunch = require("auto-launch");

const { loadConfig, getConfigPath } = require("./config");
const { getOrCreateCert } = require("./tls");
const printer = require("./printer");
const poleDisplay = require("./poleDisplay");

// Un solo proceso a la vez -- si alguien abre el agente dos veces (ej. quedó uno corriendo de
// un turno anterior), la segunda instancia simplemente se cierra en vez de pelear por el mismo
// puerto de WebSocket.
const soloInstancia = app.requestSingleInstanceLock();
if (!soloInstancia) {
  app.quit();
}

let tray = null;
let wss = null;
let httpsServer = null;
let config = null;
let impresorasDetectadas = [];

function urlAgente() {
  return `https://127.0.0.1:${config.port}/`;
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
      { label: `Vortex Print Agent -- puerto ${config.port}`, enabled: false },
      { label: `Impresoras detectadas: ${impresorasDetectadas.length}`, enabled: false },
      { type: "separator" },
      {
        // El navegador exige aceptar el certificado autofirmado una vez por PC antes de dejar
        // pasar la conexión wss:// del frontend -- este ítem abre esa página directo, sin que el
        // usuario tenga que escribir la URL a mano. Solo hace falta la primera vez (o si se
        // reinstala el agente y se regenera el certificado).
        label: "Aceptar certificado en el navegador (1 vez por PC)",
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

function iniciarServidor() {
  const { cert, key } = getOrCreateCert();

  httpsServer = https.createServer({ cert, key }, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(paginaEstado());
  });

  httpsServer.on("error", (error) => {
    dialog.showErrorBox(
      "Vortex Print Agent",
      `No se pudo iniciar el servidor en el puerto ${config.port}: ${error.message}\n\n` +
        `Puede que ya haya otra instancia corriendo, o que el puerto esté ocupado por otro programa.`
    );
  });

  wss = new WebSocket.Server({
    server: httpsServer,
    // Verifica el Origin ANTES de completar el handshake -- un origen no permitido nunca llega
    // a conectar (no hay ningún diálogo de "¿permitir?" para los orígenes que sí están en la
    // lista: se aceptan directo).
    verifyClient: (info) => origenPermitido(info.origin),
  });

  wss.on("connection", (ws) => {
    ws.on("message", (data) => manejarMensaje(ws, data));
  });

  httpsServer.listen(config.port);
}

app.on("second-instance", () => {
  // Alguien intentó abrir una segunda instancia -- no hace falta hacer nada, solo evitar que
  // la nueva instancia siga corriendo (ya se hizo con app.quit() arriba).
});

app.whenReady().then(() => {
  if (!soloInstancia) return;

  // En macOS/Linux no hace falta esta ventana en el dock -- es un agente de bandeja, no una app
  // con ventana visible.
  if (app.dock) app.dock.hide();

  config = loadConfig();
  iniciarServidor();

  tray = new Tray(iconoBandeja());
  tray.setToolTip("Vortex Print Agent");
  actualizarMenuBandeja();

  const autoLaunch = new AutoLaunch({ name: "Vortex Print Agent" });
  autoLaunch.isEnabled().then((habilitado) => {
    if (!habilitado) autoLaunch.enable().catch(() => {});
  });
});

// El agente vive en la bandeja -- cerrar todas las ventanas (las ocultas de impresión) no debe
// cerrar la app entera.
app.on("window-all-closed", (event) => event.preventDefault());
