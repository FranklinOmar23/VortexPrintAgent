package com.vortex.pos

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import kotlin.math.roundToInt

/**
 * Dibuja el HTML del ticket (el mismo que arma el POS para la PC) en una imagen del ancho de la
 * impresora térmica. Usa un WebView fuera de pantalla: así el ticket sale idéntico -- logo, tabla,
 * QR del e-CF -- sin rearmarlo en texto. Todo en el hilo principal (WebView lo exige).
 */
class RenderizadorTicket(private val contenedor: ViewGroup) {

    private val principal = Handler(Looper.getMainLooper())

    /** Devuelve los píxeles ARGB ya escalados al ancho en puntos de la impresora. */
    @SuppressLint("SetJavaScriptEnabled")
    fun renderizar(html: String, paperSize: String?, alTerminar: (Result<Triple<IntArray, Int, Int>>) -> Unit) {
        val densidad = contenedor.resources.displayMetrics.density
        val anchoPx = (EscPos.anchoCss(paperSize) * densidad).roundToInt()
        val puntos = EscPos.puntosPorAncho(paperSize)

        val vista = WebView(contenedor.context)
        vista.setBackgroundColor(Color.WHITE)
        vista.settings.javaScriptEnabled = true // solo para medir el alto del documento
        vista.settings.blockNetworkLoads = true  // el ticket trae todo adentro (logo y QR en data:)
        vista.isVerticalScrollBarEnabled = false
        // Fuera de la pantalla pero adjunto a la ventana: un WebView suelto no dibuja nada.
        vista.translationX = -100_000f
        contenedor.addView(vista, FrameLayout.LayoutParams(anchoPx, 10))

        var terminado = false
        fun terminar(resultado: Result<Triple<IntArray, Int, Int>>) {
            if (terminado) return
            terminado = true
            contenedor.removeView(vista)
            vista.destroy()
            alTerminar(resultado)
        }
        principal.postDelayed({ terminar(Result.failure(IllegalStateException("No se pudo preparar el ticket a tiempo."))) }, 20_000)

        vista.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                view.evaluateJavascript("Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)") { valor ->
                    val altoCss = valor?.toDoubleOrNull() ?: 600.0
                    val altoPx = (altoCss * densidad).roundToInt().coerceIn(50, 30_000)
                    vista.layoutParams = FrameLayout.LayoutParams(anchoPx, altoPx)
                    vista.measure(
                        View.MeasureSpec.makeMeasureSpec(anchoPx, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(altoPx, View.MeasureSpec.EXACTLY))
                    vista.layout(0, 0, anchoPx, altoPx)
                    // Un respiro para que termine de pintar las imágenes antes de capturar.
                    principal.postDelayed({
                        try {
                            terminar(Result.success(capturar(vista, anchoPx, altoPx, puntos)))
                        } catch (e: Throwable) {
                            terminar(Result.failure(e))
                        }
                    }, 400)
                }
            }
        }
        vista.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun capturar(vista: WebView, anchoPx: Int, altoPx: Int, puntos: Int): Triple<IntArray, Int, Int> {
        val original = Bitmap.createBitmap(anchoPx, altoPx, Bitmap.Config.ARGB_8888)
        val lienzo = Canvas(original)
        lienzo.drawColor(Color.WHITE)
        vista.draw(lienzo)

        val alto = (altoPx.toLong() * puntos / anchoPx).toInt().coerceAtLeast(1)
        val escalada = Bitmap.createScaledBitmap(original, puntos, alto, true)
        if (escalada !== original) original.recycle()
        val pixeles = IntArray(puntos * alto)
        escalada.getPixels(pixeles, 0, puntos, 0, 0, puntos, alto)
        escalada.recycle()
        return Triple(pixeles, puntos, alto)
    }
}
