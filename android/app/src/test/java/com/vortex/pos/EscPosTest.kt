package com.vortex.pos

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPosTest {
    private val negro = 0xFF000000.toInt()
    private val blanco = 0xFFFFFFFF.toInt()

    @Test
    fun anchosSegunPapel() {
        assertEquals(384, EscPos.puntosPorAncho("57mm"))
        assertEquals(576, EscPos.puntosPorAncho("80mm"))
        assertEquals(576, EscPos.puntosPorAncho(null))
        assertEquals(200, EscPos.anchoCss("57mm"))
        assertEquals(280, EscPos.anchoCss("80mm"))
    }

    @Test
    fun empaquetaLosPixelesNegrosEnBitsConCabeceraRaster() {
        // 10 x 2: fila 0 con el primer y el noveno píxel negros; fila 1 toda blanca.
        val pixeles = IntArray(20) { blanco }
        pixeles[0] = negro
        pixeles[8] = negro
        val bytes = EscPos.ticket(pixeles, 10, 2)

        assertArrayEquals(byteArrayOf(0x1B, 0x40), bytes.copyOfRange(0, 2))
        // GS v 0 0, 2 bytes por fila, 2 filas
        assertArrayEquals(byteArrayOf(0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0), bytes.copyOfRange(2, 10))
        assertArrayEquals(byteArrayOf(0x80.toByte(), 0x80.toByte(), 0, 0), bytes.copyOfRange(10, 14))
        // Termina avanzando papel y cortando.
        assertArrayEquals(byteArrayOf(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00), bytes.copyOfRange(14, 21))
    }

    @Test
    fun imagenesAltasSeMandanPorFranjas() {
        val bytes = EscPos.ticket(IntArray(8 * 300) { blanco }, 8, 300)
        val cabeceras = bytes.indices.count { i ->
            i + 3 < bytes.size && bytes[i] == 0x1D.toByte() && bytes[i + 1] == 0x76.toByte() && bytes[i + 2] == 0x30.toByte()
        }
        assertEquals(2, cabeceras) // 256 + 44 líneas
    }

    @Test
    fun transparenteYGrisClaroSonPapel() {
        assertFalse(EscPos.esNegro(0x00000000))
        assertFalse(EscPos.esNegro(0xFFE5E7EB.toInt()))
        assertTrue(EscPos.esNegro(0xFF4B5563.toInt()))
    }

    @Test
    fun direccionDelPosSoloDeVortex() {
        assertEquals("https://miempresa.vortex-pos.com", Preferencias.normalizarUrl("miempresa"))
        assertEquals("https://miempresa.vortex-pos.com", Preferencias.normalizarUrl(" https://MiEmpresa.vortex-pos.com/ventas "))
        assertNull(Preferencias.normalizarUrl("otrositio.com"))
        assertNull(Preferencias.normalizarUrl("vortex-pos.com.evil.com"))
        assertNull(Preferencias.normalizarUrl(""))
    }

    @Test
    fun nombreDeImpresoraConDireccion() {
        assertEquals("66:22:11:AA:BB:CC", Impresoras.direccionEntreCorchetes("MTP-II [66:22:11:AA:BB:CC]"))
        assertEquals("192.168.1.50:9100", Impresoras.direccionEntreCorchetes("Cocina [192.168.1.50:9100]"))
        assertNull(Impresoras.direccionEntreCorchetes("Sin dirección"))
    }
}
