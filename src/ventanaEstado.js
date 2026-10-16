// Ventana visible del agente: confirma que quedó instalado y corriendo y dice qué hacer a
// continuación. Antes el agente solo vivía en la bandeja (un ícono que muchos ni encuentran) y el
// único paso "visible" era aceptar un certificado en el navegador predeterminado -- que a veces no
// es el navegador donde se usa el POS, así que la aceptación no servía de nada.
const { BrowserWindow } = require("electron");

let ventana = null;

const escapar = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-DO") : "");

function construirHtml(estado) {
  const conexion = estado.ultimaConexion
    ? `<p class="ok">✓ Conectado con <b>${escapar(estado.ultimaConexion.origin)}</b> (${fecha(estado.ultimaConexion.fecha)}).</p>`
    : `<p class="pendiente">Todavía ninguna página del sistema se ha conectado.</p>`;

  const rechazo = estado.ultimoRechazo
    ? `<div class="alerta"><b>Se rechazó una conexión</b> de <code>${escapar(estado.ultimoRechazo.origin || "(sin origen)")}</code> (${fecha(estado.ultimoRechazo.fecha)}).
       Si es la dirección de tu sistema, agrégala a <code>allowedOrigins</code> en la configuración
       (menú de la bandeja → "Abrir carpeta de configuración") y reinicia el agente.</div>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Vortex Print Agent</title>
<style>
  body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; padding: 28px 32px; color: #1f2937; background: #f8fafc; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #4459E1; }
  .sub { margin: 0 0 18px; color: #64748b; font-size: 13px; }
  .ok { color: #15803d; font-weight: 600; }
  .pendiente { color: #b45309; font-weight: 600; }
  ol { padding-left: 20px; line-height: 1.6; font-size: 14px; }
  li { margin-bottom: 8px; }
  .alerta { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
  .caja { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-top: 14px; }
  code { background: #eef2ff; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .pie { margin-top: 16px; font-size: 12px; color: #94a3b8; }
</style></head>
<body>
  <h1>Vortex Print Agent está instalado y funcionando ✓</h1>
  <p class="sub">Versión ${escapar(estado.version)} · Impresoras detectadas en esta PC: ${estado.impresoras}</p>
  ${conexion}
  ${rechazo}
  <div class="caja">
    <b>Para empezar a imprimir:</b>
    <ol>
      <li>Vuelve al sistema Vortex en tu navegador y entra a <b>Configuración → Impresoras</b>.</li>
      <li>Presiona <b>"Verificar conexión"</b>. En unos segundos debe decir <b>Agente activo</b>.</li>
      <li>Si el navegador pregunta si permites que la página <b>acceda a dispositivos o aplicaciones de esta PC / red local</b>,
          elige <b>Permitir</b>. Es la forma en que el sistema le habla a este agente.</li>
    </ol>
    No hace falta aceptar ningún certificado.
  </div>
  <p class="pie">Puedes cerrar esta ventana: el agente sigue funcionando en la bandeja del sistema (junto al reloj)
  y se abre solo cada vez que se enciende la PC.</p>
</body></html>`;
}

/** Abre (o trae al frente y refresca) la ventana de estado. */
function mostrarVentanaEstado(estado) {
  const html = construirHtml(estado);
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  if (ventana && !ventana.isDestroyed()) {
    ventana.loadURL(url);
    ventana.show();
    ventana.focus();
    return;
  }

  ventana = new BrowserWindow({
    width: 620,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: "Vortex Print Agent",
    show: false,
  });
  ventana.setMenu(null);
  ventana.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ventana.webContents.on("will-navigate", (event) => event.preventDefault());
  ventana.once("ready-to-show", () => ventana.show());
  ventana.on("closed", () => {
    ventana = null;
  });
  ventana.loadURL(url);
}

module.exports = { mostrarVentanaEstado };
