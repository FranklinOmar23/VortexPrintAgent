# Vortex Print Agent

Agente local de impresión para el POS Vortex. Reemplaza a QZ Tray: corre en la bandeja del
sistema de la PC de caja, recibe tickets por WebSocket desde el frontend y los imprime directo
(sin ningún diálogo de "¿permitir?") en la impresora que elijas.

## Por qué existe

QZ Tray funciona, pero un sitio no firmado con certificado no puede "recordar" el permiso de
imprimir para siempre — pide confirmar una vez por sesión de navegador. Como este agente es
nuestro (controlamos los dos lados: la web y el programa), en vez de pedirle permiso al usuario
cada vez, el agente valida que la conexión venga de un origen conocido (la URL del frontend) y
la acepta sin preguntar. Si el origen no está en la lista, la rechaza en silencio.

## Requisitos

- Node.js 18 o superior.
- Windows por ahora (Mac queda para después, ver `package.json` → `build.mac`).

## Correr en desarrollo

```
npm install
npm start
```

Debe aparecer un ícono en la bandeja del sistema ("Vortex Print Agent"). Click derecho para ver
las impresoras detectadas, el puerto, o salir.

## Primer uso en cada PC: aceptar el certificado

El agente habla `wss://` (WebSocket cifrado) en vez de `ws://` -- es obligatorio, porque Chrome
bloquea sin excepción cualquier WebSocket sin cifrar abierto desde una página `https://`, incluso
hacia `127.0.0.1`. Para eso genera un certificado autofirmado la primera vez que corre (queda
guardado en la carpeta de datos de usuario, se reusa en los siguientes arranques).

Como es autofirmado, el navegador no confía en él por defecto -- hay que aceptarlo **una vez por
PC**: click derecho en el ícono de la bandeja → "Aceptar certificado en el navegador (1 vez por
PC)" → en la pestaña que se abre, click en "Avanzado" → "Continuar a 127.0.0.1 (no seguro)". Esa
advertencia es normal (es el aviso estándar de cualquier certificado autofirmado, no significa
que algo esté mal) y solo hace falta la primera vez; después el frontend se conecta solo.

## Configuración

La primera vez que corre, crea `config.json` en la carpeta de datos de usuario de Windows
(se abre fácil con click derecho al ícono → "Abrir carpeta de configuración"). Ahí se edita:

```json
{
  "port": 56789,
  "allowedOrigins": [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://192.168.1.55",
    "https://192.168.1.55"
  ]
}
```

Si la URL real de producción del frontend es otra, agrégala a `allowedOrigins` y reinicia el
agente (Salir → volver a abrir) para que tome el cambio.

## Empaquetar el instalador de Windows

Antes de empaquetar, reemplaza `build/icon.ico` por un ícono real (el que viene ahora es un
placeholder vacío -- sirve para `npm start` en desarrollo, pero el instalador final debería
llevar un ícono de verdad).

```
npm run build
```

Genera el instalador en `dist/`. Se instala una sola vez por PC de caja; el agente arranca solo
con Windows a partir de ahí (no hace falta abrirlo a mano cada turno).

## Protocolo (para referencia, ver `src/main.js`)

WebSocket en `ws://127.0.0.1:<port>` (default `56789`). Mensajes JSON:

- `{ "action": "listPrinters" }` → `{ "success": true, "printers": ["Star TSP100 Cutter (TSP143)", ...] }`
- `{ "action": "print", "printerName": "...", "html": "..." }` → `{ "success": true }` o `{ "success": false, "error": "..." }`
