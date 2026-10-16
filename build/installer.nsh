; Script extra del instalador NSIS (electron-builder lo incluye vía build.nsis.include).
;
; Arranque con Windows: el agente tiene que estar corriendo en la PC de caja para poder imprimir,
; así que se registra en HKCU\...\Run al instalar -- al encender la PC e iniciar sesión, Windows
; lo abre solo. La app también se auto-registra al arrancar (auto-launch, ver src/main.js) con el
; MISMO nombre de valor, así que no se duplica. Al desinstalar se borra la entrada; si no, Windows
; intentaría abrir un .exe que ya no existe en cada arranque.
;
; No es un "servicio de Windows" a propósito: un servicio corre sin escritorio (sesión 0), donde no
; puede mostrar el ícono en la bandeja ni imprimir con Electron de forma confiable.

; Cerrar el agente si está corriendo, ANTES de instalar/actualizar y de desinstalar. Sin esto, al
; desinstalar quedaba el proceso vivo (el ícono seguía en la bandeja) y sus archivos en uso no se
; podían borrar; al actualizar, la versión vieja seguía ocupando los puertos.
!macro cerrarAgente
  nsExec::Exec 'taskkill /F /IM "Vortex Print Agent.exe" /T'
  Sleep 800
!macroend

!macro customInit
  !insertmacro cerrarAgente
!macroend

!macro customUnInit
  !insertmacro cerrarAgente
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Vortex Print Agent" '"$INSTDIR\Vortex Print Agent.exe"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Vortex Print Agent"
!macroend
