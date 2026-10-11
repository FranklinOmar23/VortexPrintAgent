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
    "https://*.vortex-pos.com"
  ]
}
```

Los orígenes de `allowedOrigins` se **suman** a los que ya trae el agente por defecto
(`src/config.js`: localhost de desarrollo, `https://*.vortex-pos.com`, etc.) -- así, cuando una
versión nueva agrega un origen, también llega a las PCs que ya tenían su `config.json`. Un `*`
cubre un solo nivel de subdominio. Si la URL real de producción del frontend es otra, agrégala acá
y reinicia el agente (Salir → volver a abrir) para que tome el cambio.

## Seguridad

- El agente escucha **solo en `127.0.0.1`** (la propia PC), nunca en la red local: el chequeo de
  `Origin` protege contra páginas web en un navegador, pero cualquier programa puede mandar el
  `Origin` que quiera.
- Cada impresión tiene un tiempo máximo (45 s) y falla si la impresora pedida no existe en la PC
  (Chromium, si no, imprime en la predeterminada sin avisar).
- Las escrituras al pole display van en fila, una a la vez, sobre el mismo puerto COM.

## Empaquetar el instalador de Windows

```
npm run build:win
```

Genera **un solo archivo**: `dist/VortexPrintAgent-Setup.exe` (nombre fijo, para que el enlace de
descarga del frontend no cambie entre versiones). Cópialo a
`SistemaDeVentasFrontend/Frontend/public/downloads/` en cada despliegue (no va a git: pesa más
de lo que GitHub permite).

El instalador:

- Lleva el ícono de Vortex (`build/icon.ico`, generado del isotipo con tamaños de 16 a 256 px),
  igual que el programa instalado y su ícono en la bandeja.
- Se instala en un clic y **sin pedir permisos de administrador** (por usuario, en
  `%LOCALAPPDATA%\Programs`), así lo puede instalar el propio cajero.
- Registra el **arranque con Windows** (`build/installer.nsh`): al encender la PC e iniciar
  sesión, el agente se abre solo. El desinstalador quita ese registro.
- Para actualizar, basta con correr el instalador nuevo encima del anterior.

No es un "servicio de Windows" a propósito: un servicio corre sin escritorio (sesión 0), donde no
puede mostrar el ícono en la bandeja ni imprimir con Electron de forma confiable. Si la PC de caja
debe quedar lista sin que nadie inicie sesión, configura el inicio de sesión automático de Windows.

### Si falla con "Cannot create symbolic link : A required privilege is not held by the client"

electron-builder descarga `winCodeSign` (lo usa para ponerle el ícono al `.exe`) y ese paquete
trae dos enlaces simbólicos de macOS que Windows no deja crear sin permisos de administrador o el
"Modo de desarrollador". No hacen falta para compilar en Windows: extrae el paquete a mano,
ignorando esos dos errores, y vuelve a compilar:

```
7za x -y "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<cualquiera>.7z" -o"%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
```

(`7za` está en `node_modules\7zip-bin\win\x64\`). Alternativa: activar el Modo de desarrollador
de Windows o compilar desde una terminal como administrador.

## Protocolo (para referencia, ver `src/main.js`)

WebSocket en `ws://127.0.0.1:<port>` (default `56789`). Mensajes JSON:

- `{ "action": "listPrinters" }` → `{ "success": true, "printers": ["Star TSP100 Cutter (TSP143)", ...] }`
- `{ "action": "print", "printerName": "...", "html": "..." }` → `{ "success": true }` o `{ "success": false, "error": "..." }`
