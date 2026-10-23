package com.vortex.pos

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * Ajustes de la app: la dirección del POS de la empresa y las impresoras de red. Las Bluetooth no
 * se cargan acá: se emparejan en Ajustes de Android y aparecen solas en Vortex > Impresoras.
 */
class AjustesActivity : AppCompatActivity() {

    private lateinit var preferencias: Preferencias
    private lateinit var listaRed: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferencias = Preferencias(this)

        val columna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(32), dp(24), dp(32))
        }
        setContentView(ScrollView(this).apply { addView(columna) })

        columna.addView(titulo("Vortex POS", 26f))
        columna.addView(texto("Escribe la dirección de tu empresa en Vortex (la misma con la que entras en la computadora)."))

        val direccion = EditText(this).apply {
            hint = "miempresa.vortex-pos.com"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(preferencias.urlPos?.removePrefix("https://") ?: "")
        }
        columna.addView(direccion)

        columna.addView(titulo("Impresoras de red", 18f).conMargenArriba(dp(28)))
        columna.addView(texto("Térmicas conectadas por cable de red o WiFi (puerto 9100). Las Bluetooth se emparejan en Ajustes de Android > Bluetooth y aparecen solas."))
        listaRed = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        columna.addView(listaRed)
        pintarImpresorasRed()

        val nombre = EditText(this).apply { hint = "Nombre (ej. Caja 1)" }
        val ip = EditText(this).apply { hint = "IP (ej. 192.168.1.50)"; inputType = InputType.TYPE_CLASS_TEXT }
        val puerto = EditText(this).apply { hint = "Puerto"; setText("9100"); inputType = InputType.TYPE_CLASS_NUMBER }
        columna.addView(nombre)
        columna.addView(ip)
        columna.addView(puerto)
        columna.addView(boton("Agregar impresora de red", primario = false) {
            val ipTexto = ip.text.toString().trim()
            if (!Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(ipTexto)) {
                aviso("Escribe una IP válida, por ejemplo 192.168.1.50.")
                return@boton
            }
            val nueva = ImpresoraRed(
                nombre.text.toString().trim().ifBlank { "Impresora $ipTexto" },
                ipTexto,
                puerto.text.toString().toIntOrNull() ?: 9100)
            preferencias.impresorasRed = preferencias.impresorasRed.filterNot { it.ip == nueva.ip && it.puerto == nueva.puerto } + nueva
            nombre.setText(""); ip.setText("")
            pintarImpresorasRed()
        })

        columna.addView(boton("Guardar y abrir Vortex", primario = true) {
            val url = Preferencias.normalizarUrl(direccion.text.toString())
            if (url == null) {
                aviso("Escribe la dirección de tu empresa, por ejemplo miempresa.vortex-pos.com.")
                return@boton
            }
            preferencias.urlPos = url
            finish()
        }.conMargenArriba(dp(28)))

        columna.addView(texto("Versión ${BuildConfig.VERSION_NAME}").conMargenArriba(dp(24)))

        // Primera apertura sin dirección guardada: "atrás" cierra la app (si no, el POS vuelve a
        // abrir esta pantalla sin fin).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (preferencias.urlPos == null) finishAffinity() else finish()
            }
        })
    }

    private fun pintarImpresorasRed() {
        listaRed.removeAllViews()
        val impresoras = preferencias.impresorasRed
        if (impresoras.isEmpty()) {
            listaRed.addView(texto("Todavía no hay impresoras de red."))
            return
        }
        impresoras.forEach { impresora ->
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            fila.addView(texto("${impresora.nombre} · ${impresora.ip}:${impresora.puerto}").apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            fila.addView(boton("Quitar", primario = false) {
                preferencias.impresorasRed = preferencias.impresorasRed - impresora
                pintarImpresorasRed()
            })
            listaRed.addView(fila)
        }
    }

    // ---------------------------------------------------------------- vistas simples

    private fun dp(valor: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, valor.toFloat(), resources.displayMetrics).toInt()

    private fun titulo(contenido: String, tamano: Float) = TextView(this).apply {
        text = contenido
        setTextSize(TypedValue.COMPLEX_UNIT_SP, tamano)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.parseColor("#191847"))
    }

    private fun texto(contenido: String) = TextView(this).apply {
        text = contenido
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(Color.parseColor("#4B5563"))
        setPadding(0, dp(6), 0, dp(6))
    }

    private fun boton(etiqueta: String, primario: Boolean, alPulsar: () -> Unit) = Button(this).apply {
        text = etiqueta
        isAllCaps = false
        if (primario) {
            setBackgroundColor(Color.parseColor("#4459E1"))
            setTextColor(Color.WHITE)
        }
        setOnClickListener { alPulsar() }
    }

    private fun <T : View> T.conMargenArriba(margen: Int): T = apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .also { it.topMargin = margen }
    }

    private fun aviso(mensaje: String) = Toast.makeText(this, mensaje, Toast.LENGTH_LONG).show()
}
