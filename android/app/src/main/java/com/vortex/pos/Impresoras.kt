package com.vortex.pos

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

/**
 * Impresoras que ve la tableta y el envío de los bytes ESC/POS. Dos tipos:
 *  - Bluetooth: las ya emparejadas en Ajustes de Android (perfil serie SPP, el de las térmicas).
 *  - Red: las que se cargan en Ajustes de la app (IP y puerto, normalmente 9100).
 * El POS identifica cada impresora por su nombre; para no depender de nombres repetidos, el
 * nombre lleva la dirección entre corchetes: "MTP-II [66:22:11:AA:BB:CC]" o "Cocina [192.168.1.50:9100]".
 */
class Impresoras(private val context: Context) {

    data class Impresora(val nombre: String, val tipo: String, val direccion: String) {
        val nombreCompleto: String get() = "$nombre [$direccion]"
    }

    fun tienePermisoBluetooth(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun adaptador(): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    @SuppressLint("MissingPermission") // se verifica con tienePermisoBluetooth()
    fun listar(): List<Impresora> {
        val bluetooth = if (tienePermisoBluetooth()) {
            adaptador()?.takeIf { it.isEnabled }?.bondedDevices.orEmpty()
                .map { Impresora(it.name ?: "Impresora Bluetooth", "bluetooth", it.address) }
        } else emptyList()

        val red = Preferencias(context).impresorasRed.map { Impresora(it.nombre, "red", "${it.ip}:${it.puerto}") }
        return red + bluetooth.sortedBy { it.nombre }
    }

    /** Busca la impresora por el nombre que guardó el POS (con o sin la dirección entre corchetes). */
    fun buscar(nombreImpresora: String): Impresora? {
        val lista = listar()
        return lista.firstOrNull { it.nombreCompleto == nombreImpresora }
            ?: direccionEntreCorchetes(nombreImpresora)?.let { dir -> lista.firstOrNull { it.direccion.equals(dir, ignoreCase = true) } }
            ?: lista.firstOrNull { it.nombre == nombreImpresora }
    }

    fun enviar(impresora: Impresora, datos: ByteArray) {
        when (impresora.tipo) {
            "red" -> enviarRed(impresora.direccion, datos)
            else -> enviarBluetooth(impresora.direccion, datos)
        }
    }

    private fun enviarRed(direccion: String, datos: ByteArray) {
        val ip = direccion.substringBeforeLast(':')
        val puerto = direccion.substringAfterLast(':').toIntOrNull() ?: 9100
        Socket().use { socket ->
            socket.connect(InetSocketAddress(ip, puerto), 5000)
            socket.soTimeout = 15000
            escribirPorPartes(socket.getOutputStream(), datos)
        }
    }

    @SuppressLint("MissingPermission")
    private fun enviarBluetooth(mac: String, datos: ByteArray) {
        if (!tienePermisoBluetooth()) throw IOException("La app no tiene permiso para usar Bluetooth. Concédelo en Ajustes de Android.")
        val adaptador = adaptador() ?: throw IOException("Esta tableta no tiene Bluetooth.")
        if (!adaptador.isEnabled) throw IOException("El Bluetooth está apagado. Enciéndelo para imprimir.")
        val dispositivo = adaptador.getRemoteDevice(mac)
        adaptador.cancelDiscovery()

        // Algunas térmicas baratas solo aceptan la conexión "insegura": se prueba con ambas.
        val socket: BluetoothSocket = try {
            dispositivo.createRfcommSocketToServiceRecord(SPP).also { it.connect() }
        } catch (e: IOException) {
            dispositivo.createInsecureRfcommSocketToServiceRecord(SPP).also { it.connect() }
        }
        socket.use {
            escribirPorPartes(it.outputStream, datos)
            // Cerrar enseguida corta lo que la impresora todavía no leyó del buffer.
            Thread.sleep(800)
        }
    }

    // Las térmicas Bluetooth tienen un buffer chico: se manda en partes con una pausa corta.
    private fun escribirPorPartes(salida: OutputStream, datos: ByteArray) {
        var i = 0
        while (i < datos.size) {
            val n = minOf(1024, datos.size - i)
            salida.write(datos, i, n)
            salida.flush()
            i += n
            Thread.sleep(15)
        }
    }

    companion object {
        private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        internal fun direccionEntreCorchetes(nombre: String): String? =
            Regex("""\[([^\]]+)]\s*$""").find(nombre)?.groupValues?.get(1)
    }
}
