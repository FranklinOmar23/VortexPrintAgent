package com.vortex.pos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Impresora de red (térmica Ethernet/WiFi que recibe ESC/POS crudo, normalmente por el puerto 9100). */
data class ImpresoraRed(val nombre: String, val ip: String, val puerto: Int = 9100)

/** Lo que la app recuerda entre aperturas: la dirección del POS de la empresa y sus impresoras de red. */
class Preferencias(context: Context) {
    private val prefs = context.getSharedPreferences("vortex_pos", Context.MODE_PRIVATE)

    var urlPos: String?
        get() = prefs.getString("url_pos", null)
        set(valor) = prefs.edit().putString("url_pos", valor).apply()

    var impresorasRed: List<ImpresoraRed>
        get() {
            val json = prefs.getString("impresoras_red", "[]") ?: "[]"
            val arreglo = JSONArray(json)
            return (0 until arreglo.length()).map {
                val o = arreglo.getJSONObject(it)
                ImpresoraRed(o.getString("nombre"), o.getString("ip"), o.optInt("puerto", 9100))
            }
        }
        set(lista) {
            val arreglo = JSONArray()
            lista.forEach { arreglo.put(JSONObject().put("nombre", it.nombre).put("ip", it.ip).put("puerto", it.puerto)) }
            prefs.edit().putString("impresoras_red", arreglo.toString()).apply()
        }

    companion object {
        const val DOMINIO = "vortex-pos.com"

        /**
         * Convierte lo que escribe el usuario ("miempresa", "miempresa.vortex-pos.com" o la URL
         * completa) en la URL https del POS. Solo se aceptan direcciones de Vortex: el puente de
         * impresión no se le expone a cualquier sitio.
         */
        fun normalizarUrl(entrada: String): String? {
            var texto = entrada.trim().lowercase()
            if (texto.isEmpty()) return null
            texto = texto.removePrefix("https://").removePrefix("http://").trimEnd('/')
            val host = texto.substringBefore('/')
            val completo = if (host.contains('.')) host else "$host.$DOMINIO"
            if (!esHostPermitido(completo)) return null
            return "https://$completo"
        }

        fun esHostPermitido(host: String?): Boolean {
            if (host.isNullOrBlank()) return false
            val h = host.lowercase()
            return h == DOMINIO || h.endsWith(".$DOMINIO")
        }
    }
}
