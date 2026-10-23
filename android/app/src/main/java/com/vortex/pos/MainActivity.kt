package com.vortex.pos

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * El POS de la empresa (https://<empresa>.vortex-pos.com) a pantalla completa, con el puente
 * `VortexNativo` para imprimir en térmicas Bluetooth o de red sin ningún diálogo. La primera vez
 * (o desde Ajustes) se elige la dirección de la empresa.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var puente: PuenteNativo
    private lateinit var preferencias: Preferencias
    private var urlCargada: String? = null
    private var archivosPendientes: ValueCallback<Array<Uri>>? = null

    private val permisoBluetooth = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // <input type="file"> del POS (ej. foto del voucher de una transferencia).
    private val selectorArchivos = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { resultado ->
        archivosPendientes?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado.resultCode, resultado.data))
        archivosPendientes = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Necesario para poder dibujar el ticket completo (no solo la parte visible) en una imagen.
        WebView.enableSlowWholeDocumentDraw()
        super.onCreate(savedInstanceState)
        preferencias = Preferencias(this)

        val raiz = FrameLayout(this)
        webView = WebView(this)
        raiz.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(raiz)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // El POS reconoce la app por esto (además de por window.VortexNativo).
            userAgentString = "$userAgentString VortexPOSApp/${BuildConfig.VERSION_NAME}"
        }

        val impresoras = Impresoras(this)
        puente = PuenteNativo(this, webView, impresoras, RenderizadorTicket(raiz))
        webView.addJavascriptInterface(puente, "VortexNativo")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                when (url.scheme) {
                    "vortex" -> {
                        if (url.host == "ajustes") abrirAjustes() else cargarPos(forzar = true)
                        return true
                    }
                }
                // Dentro de la app solo el POS de Vortex; el resto (WhatsApp, pasarelas de pago,
                // enlaces de ayuda) se abre en el navegador.
                if (Preferencias.esHostPermitido(url.host)) return false
                abrirFuera(url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                puente.hostActual = url?.let { Uri.parse(it).host }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) mostrarSinConexion()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                archivosPendientes?.onReceiveValue(null)
                archivosPendientes = callback
                return try {
                    selectorArchivos.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    archivosPendientes = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        pedirPermisoBluetooth()
        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        if (preferencias.urlPos == null) abrirAjustes() else cargarPos()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Carga el POS si cambió la dirección (o si se pide recargar tras un error). */
    private fun cargarPos(forzar: Boolean = false) {
        val url = preferencias.urlPos ?: return
        if (!forzar && url == urlCargada) return
        urlCargada = url
        webView.loadUrl(url)
    }

    private fun mostrarSinConexion() {
        val html = """
            <html><body style="font-family:sans-serif;text-align:center;padding:48px;color:#191847">
            <h2>No se pudo abrir Vortex</h2>
            <p>Revisa la conexión a internet de la tableta.</p>
            <p><a href="vortex://reintentar" style="display:inline-block;padding:12px 24px;background:#4459E1;color:#fff;border-radius:10px;text-decoration:none">Reintentar</a></p>
            <p><a href="vortex://ajustes" style="color:#4459E1">Cambiar la dirección de la empresa</a></p>
            </body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    fun abrirAjustes() {
        startActivity(Intent(this, AjustesActivity::class.java))
    }

    fun pedirPermisoBluetooth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permisoBluetooth.launch(Manifest.permission.BLUETOOTH_CONNECT)
        }
    }

    private fun abrirFuera(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (e: ActivityNotFoundException) {
            // Sin app que lo abra: se ignora.
        }
    }
}
