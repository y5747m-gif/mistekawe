package com.nanjawi.majlis.audio

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** مخرج صوت واحد يراه النظام: سماعة بلوتوث، مكبر الهاتف، سماعة سلكية… */
data class OutputTarget(
    val id: Int,
    val name: String,
    val kind: String,
    val address: String,
    val device: AudioDeviceInfo?
) {
    val key: String
        get() = if (address.isNotBlank()) "bt:$address" else "dev:$id"
}

/** إعدادات المستخدم لهذا المخرج: التفعيل والمستوى والتأخير. */
data class RouteConfig(
    val target: OutputTarget,
    var gain: Float = 1f,
    var trimMs: Int = 0,
    var enabled: Boolean = true
)

object OutputScanner {

    private val WANTED = setOf(
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_ACCESSORY,
        AudioDeviceInfo.TYPE_DOCK,
        AudioDeviceInfo.TYPE_LINE_ANALOG,
        AudioDeviceInfo.TYPE_LINE_DIGITAL,
        AudioDeviceInfo.TYPE_AUX_LINE,
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC,
        AudioDeviceInfo.TYPE_HEARING_AID
    )

    @SuppressLint("MissingPermission")
    fun scan(context: Context): List<OutputTarget> {
        val manager = context.getSystemService(AudioManager::class.java) ?: return emptyList()
        val names = bluetoothNames(context)
        val devices = try {
            manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        } catch (_: Exception) {
            emptyArray<AudioDeviceInfo>()
        }
        val out = ArrayList<OutputTarget>()
        for (device in devices) {
            if (device.type !in WANTED) continue
            val address = try {
                device.address ?: ""
            } catch (_: Exception) {
                ""
            }
            val friendly = names[address.uppercase()]
            val product = try {
                device.productName.toString()
            } catch (_: Exception) {
                ""
            }
            val name = when {
                !friendly.isNullOrBlank() -> friendly
                product.isNotBlank() && product != "0" -> product
                else -> kindOf(device)
            }
            out.add(OutputTarget(device.id, name, kindOf(device), address, device))
        }
        return out.sortedWith(
            compareByDescending<OutputTarget> { it.device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
                .thenBy { it.name }
        )
    }

    @SuppressLint("MissingPermission")
    private fun bluetoothNames(context: Context): Map<String, String> {
        val map = HashMap<String, String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val granted = context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            if (!granted) return map
        }
        return try {
            val adapter = BluetoothAdapter.getDefaultAdapter() ?: return map
            for (device in adapter.bondedDevices) {
                val name = try {
                    device.name
                } catch (_: Exception) {
                    null
                }
                if (!name.isNullOrBlank()) map[device.address.uppercase()] = name
            }
            map
        } catch (_: Exception) {
            map
        }
    }

    private fun kindOf(device: AudioDeviceInfo): String = when (device.type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "سماعة بلوتوث"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "بلوتوث (مكالمات)"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "مكبر الهاتف"
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "سماعة سلكية"
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> "صوت USB"
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC -> "HDMI"
        AudioDeviceInfo.TYPE_HEARING_AID -> "سماعة طبية"
        AudioDeviceInfo.TYPE_DOCK,
        AudioDeviceInfo.TYPE_LINE_ANALOG,
        AudioDeviceInfo.TYPE_LINE_DIGITAL,
        AudioDeviceInfo.TYPE_AUX_LINE -> "مخرج خارجي"
        else -> "مخرج صوت"
    }
}
