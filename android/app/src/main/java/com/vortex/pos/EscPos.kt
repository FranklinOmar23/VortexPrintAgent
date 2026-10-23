package com.vortex.pos

import java.io.ByteArrayOutputStream

/**
 * Convierte la imagen del ticket en comandos ESC/POS (lo que entienden prácticamente todas las
 * impresoras térmicas de 58 y 80 mm). El ticket se imprime como imagen (raster "GS v 0"): así sale
 * igual que en la PC -- logo, tabla, código QR del e-CF -- sin rearmarlo en texto plano.
 * No depende de Android (recibe los píxeles como enteros ARGB) para poder probarlo en la JVM.
 */
object EscPos {
    /** Puntos por línea según el ancho de papel: 58 mm = 384 y 80 mm = 576 (a 203 dpi). */
    fun puntosPorAncho(paperSize: String?): Int = if (paperSize == "57mm") 384 else 576

    /** Ancho del ticket en px CSS, el mismo que usa el POS al armar el HTML (ANCHOS_PAPEL). */
    fun anchoCss(paperSize: String?): Int = if (paperSize == "57mm") 200 else 280

    // Las impresoras baratas no aceptan imágenes muy altas en un solo comando: se manda por franjas.
    private const val LINEAS_POR_FRANJA = 256
    // Más oscuro que esto se imprime: el texto gris claro del ticket también debe salir.
    private const val UMBRAL_LUMINANCIA = 170

    fun ticket(pixeles: IntArray, ancho: Int, alto: Int): ByteArray {
        val salida = ByteArrayOutputStream()
        salida.write(byteArrayOf(0x1B, 0x40)) // ESC @: reinicia la impresora

        val bytesPorFila = (ancho + 7) / 8
        var inicio = 0
        while (inicio < alto) {
            val filas = minOf(LINEAS_POR_FRANJA, alto - inicio)
            // GS v 0 m xL xH yL yH: imagen raster de bytesPorFila x filas.
            salida.write(byteArrayOf(0x1D, 0x76, 0x30, 0x00,
                (bytesPorFila and 0xFF).toByte(), (bytesPorFila shr 8).toByte(),
                (filas and 0xFF).toByte(), (filas shr 8).toByte()))
            val datos = ByteArray(bytesPorFila * filas)
            for (y in 0 until filas) {
                val fila = (inicio + y) * ancho
                for (x in 0 until ancho) {
                    if (esNegro(pixeles[fila + x])) {
                        val indice = y * bytesPorFila + x / 8
                        datos[indice] = (datos[indice].toInt() or (0x80 ushr (x % 8))).toByte()
                    }
                }
            }
            salida.write(datos)
            inicio += filas
        }

        salida.write(byteArrayOf(0x1B, 0x64, 0x04))             // ESC d 4: avanza 4 líneas
        salida.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00))       // GS V B 0: corte parcial (si tiene cortador)
        return salida.toByteArray()
    }

    internal fun esNegro(argb: Int): Boolean {
        val alfa = argb ushr 24 and 0xFF
        if (alfa < 128) return false // transparente = papel
        val r = argb shr 16 and 0xFF
        val g = argb shr 8 and 0xFF
        val b = argb and 0xFF
        return (r * 299 + g * 587 + b * 114) / 1000 < UMBRAL_LUMINANCIA
    }
}
