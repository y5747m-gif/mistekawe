package com.nanjawi.majlis.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import kotlin.math.max
import kotlin.math.min

/**
 * محرك الصوت: يفتح الملف مرة واحدة، ثم يكتب نفس العيّنات إلى مسار صوت مستقل
 * لكل مخرج مفعّل. كل مسار يُوجَّه بـ setPreferredDevice إلى سماعة بعينها،
 * ولذلك يمكن لعدة سماعات بلوتوث أن تعزف في وقت واحد.
 */
class MultiAudioEngine(private val appContext: Context) {

    interface Listener {
        fun onError(message: String)
    }

    data class State(
        val playing: Boolean,
        val positionMs: Long,
        val durationMs: Long,
        val activeOutputs: Int,
        val sourceName: String
    )

    private val lock = Any()
    private val slots = ArrayList<Slot>()
    private var listener: Listener? = null

    private var extractor: MediaExtractor? = null
    private var codec: MediaCodec? = null
    private var thread: Thread? = null

    @Volatile private var running = false
    @Volatile private var audioBytesWritten = 0L
    @Volatile private var maxLatencyFrames = 0

    private var eosReached = false
    private var sawInputEos = false
    private var pendingRestartUs: Long? = null
    private var pendingRecreate = false

    private var uri: Uri? = null
    private var sourceName = ""
    private var sampleRate = 44100
    private var channels = 2
    private var frameBytes = 4
    private var durationUs = 0L
    private var startUs = 0L
    private var master = 0.85f

    var looping: Boolean = true

    private inner class Slot(var route: RouteConfig) {
        var track: AudioTrack? = null
        var latencyFrames: Int = 0
        var padFrames: Int = 0
        var aligned: Boolean = false
    }

    fun setListener(value: Listener?) {
        listener = value
    }

    fun hasSource(): Boolean = uri != null

    fun sourceName(): String = sourceName

    fun durationMs(): Long = durationUs / 1000L

    fun isPlaying(): Boolean = running

    fun setMaster(value: Float) {
        master = value.coerceIn(0f, 1f)
        applyVolumes()
    }

    // ---------------------------------------------------------------- المصدر

    fun setSource(next: Uri, name: String) {
        stop()
        uri = next
        sourceName = name
        startUs = 0L
        durationUs = 0L
        audioBytesWritten = 0L
        probeDuration()
    }

    private fun probeDuration() {
        val target = uri ?: return
        var probe: MediaExtractor? = null
        try {
            probe = MediaExtractor()
            openDataSource(probe, target)
            for (i in 0 until probe.trackCount) {
                val format = probe.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("audio/")) {
                    durationUs = if (format.containsKey(MediaFormat.KEY_DURATION_US)) {
                        format.getLong(MediaFormat.KEY_DURATION_US)
                    } else {
                        0L
                    }
                    break
                }
            }
        } catch (_: Exception) {
            durationUs = 0L
        } finally {
            try {
                probe?.release()
            } catch (_: Exception) {
                /* تجاهل */
            }
        }
    }

    private fun openDataSource(extractor: MediaExtractor, source: Uri) {
        if (source.scheme == "file") {
            extractor.setDataSource(source.path ?: "")
        } else {
            extractor.setDataSource(appContext, source, null)
        }
    }

    // -------------------------------------------------------------- المخارج

    fun setRoutes(routes: List<RouteConfig>) {
        synchronized(lock) {
            val byKey = HashMap<String, Slot>()
            for (slot in slots) byKey[slot.route.target.key] = slot
            val next = ArrayList<Slot>()
            for (route in routes) {
                val existing = byKey.remove(route.target.key)
                if (existing != null) {
                    existing.route = route
                    next.add(existing)
                } else {
                    next.add(Slot(route))
                }
            }
            for (gone in byKey.values) releaseSlot(gone)
            slots.clear()
            slots.addAll(next)
        }
        applyVolumes()
        if (running) {
            try {
                ensureTracks()
                startTracks()
            } catch (e: Exception) {
                listener?.onError("تعذّر تشغيل مخرج جديد: ${e.message ?: ""}")
            }
        }
    }

    fun setGain(key: String, gain: Float) {
        synchronized(lock) {
            for (slot in slots) if (slot.route.target.key == key) slot.route.gain = gain
        }
        applyVolumes()
    }

    fun setTrim(key: String, trimMs: Int) {
        synchronized(lock) {
            for (slot in slots) {
                if (slot.route.target.key == key) {
                    slot.route.trimMs = trimMs
                    if (!slot.aligned) {
                        slot.padFrames = basePad(slot) + (trimMs * sampleRate) / 1000
                    }
                }
            }
        }
    }

    fun activeCount(): Int {
        synchronized(lock) {
            return slots.count { it.route.enabled && it.track != null }
        }
    }

    // ------------------------------------------------------------- التشغيل

    fun play() {
        if (uri == null) {
            listener?.onError("اختر ملفًا صوتيًا أولًا بالضغط على «اختيار ملف صوتي».")
            return
        }
        if (running) return
        val anyEnabled: Boolean
        synchronized(lock) { anyEnabled = slots.any { it.route.enabled } }
        if (!anyEnabled) {
            listener?.onError("فعّل مخرجًا واحدًا على الأقل من قائمة السماعات.")
            return
        }
        running = true
        eosReached = false
        audioBytesWritten = 0L
        thread = Thread {
            try {
                restart(startUs, true)
                pump()
            } catch (e: Exception) {
                listener?.onError("توقف التشغيل: ${e.message ?: ""}")
            } finally {
                cleanup()
            }
        }.apply { name = "majlis-audio"; start() }
    }

    fun pause() {
        if (!running) return
        startUs = state().positionMs * 1000L
        running = false
        joinThread()
        synchronized(lock) { stopAllTracks() }
        releaseCodec()
        audioBytesWritten = 0L
    }

    fun stop() {
        running = false
        joinThread()
        synchronized(lock) { stopAllTracks() }
        releaseCodec()
        startUs = 0L
        audioBytesWritten = 0L
    }

    fun seek(positionMs: Long) {
        val target = positionMs.coerceIn(0L, max(durationMs(), 0L))
        if (!running) {
            startUs = target * 1000L
            audioBytesWritten = 0L
            return
        }
        startUs = target * 1000L
        pendingRestartUs = startUs
        pendingRecreate = true
    }

    fun state(): State {
        val duration = max(durationMs(), 0L)
        val position = if (running || audioBytesWritten > 0L) {
            currentPositionMs()
        } else {
            startUs / 1000L
        }
        val active: Int
        synchronized(lock) { active = slots.count { it.route.enabled } }
        return State(running, position.coerceIn(0L, duration), duration, active, sourceName)
    }

    private fun currentPositionMs(): Long {
        val frames = audioBytesWritten / frameBytes - maxLatencyFrames
        if (frames <= 0L) return 0L
        return (frames * 1000L) / sampleRate
    }

    // ---------------------------------------------------------- دورة البث

    private fun pump() {
        val info = MediaCodec.BufferInfo()
        while (running) {
            val restartAt = pendingRestartUs
            if (restartAt != null) {
                pendingRestartUs = null
                val recreate = pendingRecreate
                pendingRecreate = false
                restart(restartAt, recreate)
                continue
            }
            if (eosReached) {
                Thread.sleep(60)
                continue
            }
            val decoder = codec ?: break
            if (!sawInputEos) feedInput(decoder)
            val index = decoder.dequeueOutputBuffer(info, 200)
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue
            if (index < 0) continue
            val buffer = decoder.getOutputBuffer(index)
            val size = info.size
            if (buffer != null && size > 0) {
                val bytes = ByteArray(size)
                val offset = info.offset
                try {
                    buffer.position(offset)
                    buffer.get(bytes, 0, size)
                } catch (_: Exception) {
                    /* عيّنة تالفة: تُتجاهل */
                }
                writeAll(bytes)
            }
            try {
                decoder.releaseOutputBuffer(index, false)
            } catch (_: Exception) {
                /* تجاهل */
            }
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                eosReached = true
                val tail = latencyMillis() + 160L
                if (looping) {
                    Thread.sleep(tail)
                    audioBytesWritten = 0L
                    pendingRestartUs = 0L
                    pendingRecreate = false
                } else {
                    Thread.sleep(tail)
                    running = false
                }
            }
        }
    }

    private fun restart(atUs: Long, recreate: Boolean) {
        if (recreate) {
            synchronized(lock) { stopAllTracks() }
        }
        audioBytesWritten = 0L
        eosReached = false
        createDecoder(atUs)
        primeFormat()
        if (recreate) {
            ensureTracks()
            startTracks()
        }
        applyVolumes()
    }

    private fun createDecoder(atUs: Long) {
        releaseCodec()
        val source = uri ?: throw IllegalStateException("لا يوجد ملف")
        val extractor = MediaExtractor()
        openDataSource(extractor, source)
        var trackIndex = -1
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: ""
            if (mime.startsWith("audio/")) {
                trackIndex = i
                break
            }
        }
        if (trackIndex < 0) {
            extractor.release()
            throw IllegalStateException("الملف لا يحتوي على مسار صوت")
        }
        val format = extractor.getTrackFormat(trackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (format.containsKey(MediaFormat.KEY_DURATION_US)) {
            durationUs = format.getLong(MediaFormat.KEY_DURATION_US)
        }
        extractor.selectTrack(trackIndex)
        if (atUs > 0) extractor.seekTo(atUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        this.extractor = extractor
        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(format, null, null, 0)
        decoder.start()
        this.codec = decoder
        sawInputEos = false
    }

    private fun primeFormat() {
        val decoder = codec ?: return
        val info = MediaCodec.BufferInfo()
        val deadline = System.currentTimeMillis() + 6000
        while (System.currentTimeMillis() < deadline) {
            if (!sawInputEos) feedInput(decoder)
            val index = decoder.dequeueOutputBuffer(info, 200)
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                val format = decoder.outputFormat
                sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                    format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                } else {
                    44100
                }
                channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                    format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else {
                    2
                }
                if (channels < 1) channels = 2
                frameBytes = channels * 2
                return
            }
            if (index >= 0) {
                try {
                    decoder.releaseOutputBuffer(index, false)
                } catch (_: Exception) {
                    /* تجاهل */
                }
            }
        }
    }

    private fun feedInput(decoder: MediaCodec) {
        if (sawInputEos) return
        val extractor = this.extractor ?: return
        val index = decoder.dequeueInputBuffer(2000)
        if (index < 0) return
        val buffer = decoder.getInputBuffer(index) ?: return
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
            decoder.queueInputBuffer(index, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            sawInputEos = true
            return
        }
        val time = extractor.sampleTime
        decoder.queueInputBuffer(index, 0, size, time, 0)
        extractor.advance()
    }

    private fun writeAll(data: ByteArray) {
        val snapshot: List<Slot>
        synchronized(lock) { snapshot = ArrayList(slots) }
        for (slot in snapshot) {
            val track = slot.track ?: continue
            if (!slot.route.enabled) continue
            if (slot.padFrames > 0) {
                var left = slot.padFrames
                while (left > 0) {
                    val frames = minOf(left, 2048)
                    val silence = ByteArray(frames * frameBytes)
                    val written = try {
                        track.write(silence, 0, silence.size, AudioTrack.WRITE_BLOCKING)
                    } catch (_: Exception) {
                        -1
                    }
                    if (written <= 0) break
                    left -= frames
                }
                slot.padFrames = 0
            }
            var offset = 0
            while (offset < data.size) {
                val chunk = minOf(data.size - offset, 32768)
                val written = try {
                    track.write(data, offset, chunk, AudioTrack.WRITE_BLOCKING)
                } catch (_: Exception) {
                    -1
                }
                if (written <= 0) break
                offset += written
            }
        }
        audioBytesWritten += data.size
    }

    // ------------------------------------------------------------- المسارات

    private fun ensureTracks() {
        synchronized(lock) {
            for (slot in slots) {
                if (slot.track == null) slot.track = buildTrack(slot)
            }
            alignPads()
        }
    }

    private fun buildTrack(slot: Slot): AudioTrack? {
        val device: AudioDeviceInfo? = slot.route.target.device
        val mask = if (channels >= 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
        val minimum = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
        val requested = maxOf(maxOf(minimum, 24 * 1024), 4096) * 2
        return try {
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(mask)
                .build()
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val track = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format)
                .setBufferSizeInBytes(requested)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            if (device != null) track.setPreferredDevice(device)
            slot.latencyFrames = requested / frameBytes
            slot.aligned = false
            track
        } catch (e: Exception) {
            listener?.onError("تعذّر فتح «${slot.route.target.name}»: ${e.message ?: ""}")
            null
        }
    }

    private fun alignPads() {
        val live = slots.filter { it.track != null && it.route.enabled }
        val maxLatency = live.maxOfOrNull { it.latencyFrames } ?: 0
        maxLatencyFrames = maxLatency
        for (slot in live) {
            if (slot.aligned) continue
            slot.padFrames = (maxLatency - slot.latencyFrames) + (slot.route.trimMs * sampleRate) / 1000
            slot.aligned = true
        }
    }

    private fun basePad(slot: Slot): Int {
        val live: List<Slot>
        synchronized(lock) { live = slots.filter { it.track != null && it.route.enabled } }
        val maxLatency = live.maxOfOrNull { it.latencyFrames } ?: 0
        return maxOf(0, maxLatency - slot.latencyFrames)
    }

    private fun startTracks() {
        synchronized(lock) {
            for (slot in slots) {
                val track = slot.track ?: continue
                if (!slot.route.enabled) continue
                if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
                    try {
                        track.play()
                    } catch (_: Exception) {
                        /* تجاهل */
                    }
                }
            }
        }
    }

    private fun applyVolumes() {
        synchronized(lock) {
            for (slot in slots) {
                val track = slot.track ?: continue
                try {
                    track.setVolume((slot.route.gain * master).coerceIn(0f, 1f))
                } catch (_: Exception) {
                    /* تجاهل */
                }
            }
        }
    }

    private fun stopAllTracks() {
        for (slot in slots) releaseSlot(slot)
    }

    private fun releaseSlot(slot: Slot) {
        val track = slot.track ?: return
        try {
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
        } catch (_: Exception) {
            /* تجاهل */
        }
        try {
            track.flush()
        } catch (_: Exception) {
            /* تجاهل */
        }
        try {
            track.stop()
        } catch (_: Exception) {
            /* تجاهل */
        }
        try {
            track.release()
        } catch (_: Exception) {
            /* تجاهل */
        }
        slot.track = null
        slot.padFrames = 0
        slot.aligned = false
    }

    private fun releaseCodec() {
        try {
            codec?.stop()
        } catch (_: Exception) {
            /* تجاهل */
        }
        try {
            codec?.release()
        } catch (_: Exception) {
            /* تجاهل */
        }
        codec = null
        try {
            extractor?.release()
        } catch (_: Exception) {
            /* تجاهل */
        }
        extractor = null
    }

    private fun latencyMillis(): Long {
        return (maxLatencyFrames * 1000L) / maxOf(1, sampleRate)
    }

    private fun joinThread() {
        val current = thread ?: return
        try {
            current.join(1200)
        } catch (_: Exception) {
            /* تجاهل */
        }
        thread = null
    }

    private fun cleanup() {
        synchronized(lock) { stopAllTracks() }
        releaseCodec()
        running = false
    }
}
