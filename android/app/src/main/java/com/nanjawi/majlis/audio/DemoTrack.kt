package com.nanjawi.majlis.audio

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import kotlin.math.PI
import kotlin.math.sin

/** مقطع تجريبي يُولّد داخل الهاتف حتى يمكن التجربة فورًا دون اختيار ملف. */
object DemoTrack {

    private const val SAMPLE_RATE = 44100
    private const val SECONDS = 16

    fun file(context: Context): File {
        val out = File(context.cacheDir, "majlis_demo.wav")
        if (!out.exists() || out.length() < 1000L) write(out)
        return out
    }

    private fun write(out: File) {
        val total = SAMPLE_RATE * SECONDS
        val data = ByteArray(total * 4) // ستيريو · 16 بت
        val scale = doubleArrayOf(261.63, 293.66, 311.13, 349.23, 392.00, 415.30, 466.16, 523.25)
        var index = 0
        for (i in 0 until total) {
            val t = i.toDouble() / SAMPLE_RATE
            val step = (t / 0.85).toInt() % scale.size
            val freq = scale[step]
            val inside = (t % 0.85) / 0.85
            val envelope = when {
                inside < 0.06 -> inside / 0.06
                inside > 0.7 -> ((1.0 - inside) / 0.3).coerceIn(0.0, 1.0)
                else -> 1.0
            }
            val pad = 0.10 * sin(2 * PI * 130.81 * t) * (0.55 + 0.45 * sin(2 * PI * 0.35 * t))
            val lead = 0.30 * sin(2 * PI * freq * t) + 0.10 * sin(2 * PI * freq * 2 * t)
            var sample = (lead * envelope + pad) * 0.85
            if (sample > 1.0) sample = 1.0
            if (sample < -1.0) sample = -1.0
            val value = (sample * 32767.0).toInt().toShort()
            val low = (value.toInt() and 0xFF).toByte()
            val high = ((value.toInt() shr 8) and 0xFF).toByte()
            data[index++] = low
            data[index++] = high
            data[index++] = low
            data[index++] = high
        }
        FileOutputStream(out).use { stream ->
            writeHeader(stream, data.size, SAMPLE_RATE)
            stream.write(data)
            stream.flush()
        }
    }

    private fun writeHeader(stream: FileOutputStream, dataLength: Int, sampleRate: Int) {
        val header = ByteArray(44)
        fun text(offset: Int, value: String) {
            for ((i, char) in value.toCharArray().withIndex()) header[offset + i] = char.code.toByte()
        }
        fun int32(offset: Int, value: Int) {
            header[offset] = (value and 0xFF).toByte()
            header[offset + 1] = ((value shr 8) and 0xFF).toByte()
            header[offset + 2] = ((value shr 16) and 0xFF).toByte()
            header[offset + 3] = ((value shr 24) and 0xFF).toByte()
        }
        text(0, "RIFF")
        int32(4, 36 + dataLength)
        text(8, "WAVE")
        text(12, "fmt ")
        int32(16, 16)
        int32(20, 1)
        int32(22, 2)
        int32(24, sampleRate)
        int32(28, sampleRate * 4)
        int32(32, 4)
        int32(34, 16)
        text(36, "data")
        int32(40, dataLength)
        stream.write(header)
    }
}
