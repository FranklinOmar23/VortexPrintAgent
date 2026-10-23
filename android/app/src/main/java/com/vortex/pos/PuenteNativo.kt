package com.vortex.pos

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Lo que el POS ve como `window.VortexNativo`. Recibe los MISMOS mensajes que el agente de
 * escritorio (ping, listPrinters, print...) para que localPrintAgentService solo cambie el canal,
 * y responde llamando a `window.__vortexNativoRespuesta(id, respuesta)`.
 * Solo atiende a páginas de vortex-pos.com (el WebView no navega a otros sitios, pero se verifica igual).
 */
class PuenteNativo(
    private val actividad: MainActivity,
    private val webView: WebView,
    private val impresoras: Impresoras,
    private val renderizador: RenderizadorTicket,
) {
    /** Host de la página cargada, actualizado por MainActivity en cada navegación. */
    @Volatile var hostActual: String? = null

    // Una impresión a la vez: dos tickets simultáneos a la misma térmica Bluetooth se pisan.
    private val trabajo = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun abrirAjustes() {
        actividad.runOnUiThread { actividad.abrirAjustes() }
    }

    @JavascriptInterface
    fun enviar(id: String, mensajeJson: String) {
        if (!Preferencias.esHostPermitido(hostActual)) {
            responder(id, error("Origen no permitido."))
            return
        }
        val mensaje = try { JSONObject(mensajeJson) } catch (e: Exception) {
            responder(id, error("Mensaje inválido."))
            return
        }

        when (mensaje.optString("action")) {
            "ping" -> responder(id, ok().put("version", BuildConfig.VERSION_NAME).put("plataforma", "android"))
            "listPrinters" -> trabajo.execute { responder(id, listar()) }
            "print" -> imprimir(id, mensaje)
            // La tableta no tiene puertos serie: balanza y pole display se usan desde una PC con el agente.
            "listSerialPorts" -> responder(id, ok().put("ports", JSONArray()))
            "poleDisplayWrite", "poleDisplayClear" -> responder(id, error("El pole display no está disponible en la tableta."))
            "leerBalanza" -> responder(id, error("La balanza no está disponible en la tableta."))
            else -> responder(id, error("Acción desconocida: ${mensaje.optString("action")}"))
        }
    }

    private fun listar(): JSONObject {
        if (!impresoras.tienePermisoBluetooth()) actividad.runOnUiThread { actividad.pedirPermisoBluetooth() }
        val lista = JSONArray()
        impresoras.listar().forEach {
            lista.put(JSONObject()
                .put("name", it.nombreCompleto)
                .put("isDefault", false)
                .put("isOffline", false)
                .put("isLocal", it.tipo == "bluetooth"))
        }
        return ok().put("printers", lista)
    }

    private fun imprimir(id: String, mensaje: JSONObject) {
        val nombre = mensaje.optString("printerName")
        val html = mensaje.optString("html")
        val paperSize = mensaje.optString("paperSize").ifBlank { null }

        trabajo.execute {
            val impresora = impresoras.buscar(nombre)
            if (impresora == null) {
                responder(id, error("No se encontró la impresora \"$nombre\" en esta tableta. Revisa que esté emparejada (Bluetooth) o cargada en Ajustes de la app (red)."))
                return@execute
            }

            // El dibujo del ticket va en el hilo principal; el envío, en este.
            val bloqueo = java.util.concurrent.CountDownLatch(1)
            var imagen: Result<Triple<IntArray, Int, Int>>? = null
            actividad.runOnUiThread {
                renderizador.renderizar(html, paperSize) { resultado ->
                    imagen = resultado
                    bloqueo.countDown()
                }
            }
            bloqueo.await()

            val respuesta = imagen!!.fold(
                onSuccess = { (pixeles, ancho, alto) ->
                    try {
                        impresoras.enviar(impresora, EscPos.ticket(pixeles, ancho, alto))
                        ok()
                    } catch (e: Exception) {
                        error("No se pudo imprimir en ${impresora.nombre}: ${e.message ?: "verifica que esté encendida y cerca de la tableta"}.")
                    }
                },
                onFailure = { error(it.message ?: "No se pudo preparar el ticket.") },
            )
            responder(id, respuesta)
        }
    }

    private fun ok() = JSONObject().put("success", true)
    private fun error(mensaje: String) = JSONObject().put("success", false).put("error", mensaje)

    private fun responder(id: String, respuesta: JSONObject) {
        val js = "window.__vortexNativoRespuesta && window.__vortexNativoRespuesta(${JSONObject.quote(id)}, ${respuesta})"
        actividad.runOnUiThread { webView.evaluateJavascript(js, null) }
    }
}
