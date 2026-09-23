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
import android.os.Build
import android.util.Log
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/**
 * محرك صوت محسّن ومتين:
 * - كل مخرج له طابور مستقل وخيط كتابة مستقل حتى لا تعرقل سماعة بطيئة البقية.
 * - Buffer كبير للبلوتوث (600ms) لتجنب التقطيع.
 * - كتابة غير متزامنة بين المخارج لمنع انقطاع الصوت عند تعدد السماعات.
 * - معالجة صحيحة لإعادة التوجيه، والـ seek، والـ trim.
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

        // طابور مستقل لكل مخرج
        val queue: ArrayDeque<ByteArray> = ArrayDeque()
        val queueLock = Object()
        var leftover: ByteArray? = null
        var leftoverOffset: Int = 0

        var writerThread: Thread? = null
        var writerRunning = AtomicBoolean(false)
        var writerErrorCount = 0

        fun clearQueue() {
            synchronized(queueLock) {
                queue.clear()
                leftover = null
                leftoverOffset = 0
            }
        }

        fun queueSize(): Int {
            synchronized(queueLock) { return queue.size }
        }
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
                    durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
                        format.getLong(MediaFormat.KEY_DURATION)
                    } else {
                        0L
                    }
                    break
                }
            }
        } catch (_: Exception) {
            durationUs = 0L
        } finally {
            try { probe?.release() } catch (_: Exception) {}
        }
    }

    private fun openDataSource(extractor: MediaExtractor, source: Uri) {
        try {
            if (source.scheme == "file") {
                val path = source.path
                if (!path.isNullOrBlank()) {
                    extractor.setDataSource(path)
                    return
                }
            }
            extractor.setDataSource(appContext, source, null)
        } catch (e: Exception) {
            // محاولة أخيرة بدون headers
            extractor.setDataSource(appContext, source, null)
        }
    }

    // -------------------------------------------------------------- المخارج

    fun setRoutes(routes: List<RouteConfig>) {
        val toRelease = ArrayList<Slot>()
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
            for (gone in byKey.values) toRelease.add(gone)
            slots.clear()
            slots.addAll(next)
        }
        // إطلاق الموارد خارج القفل
        for (slot in toRelease) releaseSlot(slot)

        applyVolumes()
        if (running) {
            try {
                ensureTracks()
                startTracks()
            } catch (e: Exception) {
                Log.e("MultiAudioEngine", "ensureTracks failed", e)
                listener?.onError("تعذّر تشغيل مخرج جديد: ${e.message ?: ""}")
            }
        } else {
            // حتى لو متوقف، جهّز المسارات للمستقبل إذا لزم
            try { ensureTracks() } catch (_: Exception) {}
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
                    // إعادة حساب الـ pad فقط إذا لم يكن قد تمت مواءمته بعد، أو أعد المواءمة
                    if (!slot.aligned) {
                        slot.padFrames = basePad(slot) + (trimMs * sampleRate) / 1000
                    } else {
                        // إعادة مواءمة كاملة
                        slot.aligned = false
                    }
                }
            }
            if (slots.any { !it.aligned }) alignPads()
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
                Log.e("MultiAudioEngine", "pump crashed", e)
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
        synchronized(lock) { stopAllTracksKeepSlots() }
        releaseCodec()
        audioBytesWritten = 0L
    }

    fun stop() {
        running = false
        joinThread()
        // إيقاف كل الخيوط والمسارات مع الحفاظ على قائمة الـ slots لإعادة الاستخدام
        synchronized(lock) { stopAllTracksKeepSlots() }
        releaseCodec()
        startUs = 0L
        audioBytesWritten = 0L
    }

    // نسخة stop تحافظ على الـ slots (تُستخدم من pause)
    private fun stopAllTracksKeepSlots() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) {
            // إيقاف الكاتب وإبقاء الـ slot
            stopWriter(slot)
            val track = slot.track
            if (track != null) {
                try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause() } catch (_: Exception) {}
                try { track.flush() } catch (_: Exception) {}
                try { track.stop() } catch (_: Exception) {}
                try { track.release() } catch (_: Exception) {}
            }
            slot.track = null
            slot.padFrames = 0
            slot.aligned = false
            slot.clearQueue()
        }
    }

    fun seek(positionMs: Long) {
        val target = positionMs.coerceIn(0L, max(durationMs(), 0L))
        if (!running) {
            startUs = target * 1000L
            audioBytesWritten = 0L
            // امسح طوابير
            synchronized(lock) { for (s in slots) s.clearQueue() }
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
        val frames = audioBytesWritten / max(1, frameBytes) - maxLatencyFrames
        if (frames <= 0L) return 0L
        return (frames * 1000L) / max(1, sampleRate)
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
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                // حدث تغير الفورمات بعد البدء
                val format = decoder.outputFormat
                sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else sampleRate
                channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else channels
                if (channels < 1) channels = 2
                frameBytes = channels * 2
                continue
            }
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
                    // عيّنة تالفة
                }
                writeAllEnqueue(bytes)
            }
            try { decoder.releaseOutputBuffer(index, false) } catch (_: Exception) {}
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                eosReached = true
                val tail = latencyMillis() + 250L
                if (looping) {
                    Thread.sleep(tail)
                    audioBytesWritten = 0L
                    pendingRestartUs = 0L
                    pendingRecreate = false
                    // امسح الطوابير لإعادة البدء
                    synchronized(lock) { for (s in slots) s.clearQueue() }
                } else {
                    Thread.sleep(tail)
                    running = false
                }
            }
        }
    }

    private fun restart(atUs: Long, recreate: Boolean) {
        if (recreate) {
            synchronized(lock) {
                // لا نطلق المسارات، فقط نوقف الكتابة مؤقتاً ونمسح الطوابير
                for (slot in slots) {
                    slot.clearQueue()
                    slot.padFrames = 0
                    slot.aligned = false
                }
                stopWritersOnly()
            }
        } else {
            synchronized(lock) { for (slot in slots) slot.clearQueue() }
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

    private fun stopWritersOnly() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) stopWriter(slot)
        // أعد تشغيل الكتاب بعد إعادة المحاذاة
        for (slot in copy) {
            if (slot.route.enabled && slot.track != null) startWriter(slot)
        }
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
        if (format.containsKey(MediaFormat.KEY_DURATION)) {
            durationUs = format.getLong(MediaFormat.KEY_DURATION)
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
                sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
                channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
                if (channels < 1) channels = 2
                frameBytes = channels * 2
                return
            }
            if (index >= 0) {
                try { decoder.releaseOutputBuffer(index, false) } catch (_: Exception) {}
                // حتى لو لم يتغير الفورمات، نحاول قراءة الفورمات الافتراضي
                try {
                    val format = decoder.outputFormat
                    if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    if (channels < 1) channels = 2
                    frameBytes = channels * 2
                } catch (_: Exception) {}
                return
            }
        }
        // fallback
        if (channels < 1) channels = 2
        frameBytes = channels * 2
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

    private fun writeAllEnqueue(data: ByteArray) {
        val snapshot: List<Slot>
        synchronized(lock) { snapshot = ArrayList(slots) }
        for (slot in snapshot) {
            if (!slot.route.enabled) continue
            if (slot.track == null) continue
            // تجنب امتلاء الطابور بشكل مفرط (حد 40 قطعة ≈ 1.2 ثانية)
            synchronized(slot.queueLock) {
                if (slot.queue.size > 60) {
                    // إذا امتلأ، انتظر قليلاً أو احذف الأقدم للحفاظ على التزامن
                    // نحذف الأقدم لتجنب تأخر كبير
                    while (slot.queue.size > 50) slot.queue.removeFirst()
                }
                slot.queue.addLast(data)
                slot.queueLock.notifyAll()
            }
        }
        audioBytesWritten += data.size
    }

    // ------------------------------------------------------------- المسارات

    private fun ensureTracks() {
        val toBuild = ArrayList<Slot>()
        synchronized(lock) {
            for (slot in slots) {
                if (!slot.route.enabled) {
                    // إذا معطل، أطلق المسار إن وجد
                    if (slot.track != null) {
                        // سيتم إطلاقه خارج القفل
                        toBuild.add(slot) // علامة لإطلاق؟ سنعالج لاحقاً
                    }
                    continue
                }
                if (slot.track == null) toBuild.add(slot)
            }
            // نظف المعطلة
            for (slot in slots) {
                if (!slot.route.enabled && slot.track != null) {
                    // سنطلقها
                }
            }
            alignPads()
        }
        // بناء المسارات خارج القفل
        for (slot in slots.filter { it.route.enabled && it.track == null }) {
            val track = buildTrack(slot)
            synchronized(lock) {
                slot.track = track
                if (track != null) {
                    // إعادة حساب الـ latency
                    alignPads()
                }
            }
            if (track != null) startWriter(slot)
        }
        // إطلاق المعطلة
        val disabled: List<Slot>
        synchronized(lock) { disabled = slots.filter { !it.route.enabled && it.track != null } }
        for (slot in disabled) releaseSlot(slot)

        // إعادة مواءمة بعد البناء
        synchronized(lock) { alignPads() }
    }

    private fun buildTrack(slot: Slot): AudioTrack? {
        val device: AudioDeviceInfo? = slot.route.target.device
        val isBt = device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                (Build.VERSION.SDK_INT >= 31 && (
                        device?.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                                device?.type == AudioDeviceInfo.TYPE_BLE_SPEAKER))

        val mask = if (channels >= 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
        val safeMin = if (minBuffer <= 0) 8192 else minBuffer

        // حجم Buffer كبير للبلوتوث لتجنب التقطيع
        val targetMs = if (isBt) 600 else 250
        val desiredBytes = (sampleRate * frameBytes * targetMs) / 1000
        var bufferSize = max(safeMin * 4, desiredBytes)
        // اجعله مضاعف لـ frameBytes
        bufferSize = ((bufferSize + frameBytes - 1) / frameBytes) * frameBytes
        // حد أقصى معقول 256KB
        bufferSize = min(bufferSize, 256 * 1024)

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
            val builder = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)

            if (Build.VERSION.SDK_INT >= 26) {
                builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_NONE)
            }

            val track = builder.build()
            var preferredOk = true
            if (device != null) {
                try {
                    preferredOk = track.setPreferredDevice(device)
                    if (!preferredOk) {
                        Log.w("MultiAudioEngine", "setPreferredDevice returned false for ${slot.route.target.name}")
                    }
                } catch (e: Exception) {
                    Log.w("MultiAudioEngine", "setPreferredDevice exception", e)
                    preferredOk = false
                }
            }

            // تحقق إضافي: إذا كان الجهاز بلوتوث وفشل التفضيل، نحاول مرة أخرى بعد play
            slot.latencyFrames = bufferSize / max(1, frameBytes)
            slot.aligned = false
            slot.writerErrorCount = 0

            // لا نبدأ التشغيل هنا، سيبدأ في startTracks
            track
        } catch (e: Exception) {
            Log.e("MultiAudioEngine", "buildTrack failed for ${slot.route.target.name}", e)
            listener?.onError("تعذّر فتح «${slot.route.target.name}»: ${e.message ?: ""}")
            null
        }
    }

    private fun startWriter(slot: Slot) {
        if (slot.writerRunning.get()) return
        slot.writerRunning.set(true)
        val thread = Thread {
            try {
                writerLoop(slot)
            } catch (e: Exception) {
                Log.e("MultiAudioEngine", "writerLoop crashed for ${slot.route.target.name}", e)
            } finally {
                slot.writerRunning.set(false)
            }
        }
        thread.name = "majlis-writer-${slot.route.target.key.take(12)}"
        thread.isDaemon = true
        slot.writerThread = thread
        thread.start()
    }

    private fun stopWriter(slot: Slot) {
        slot.writerRunning.set(false)
        synchronized(slot.queueLock) { slot.queueLock.notifyAll() }
        val t = slot.writerThread
        if (t != null) {
            try { t.join(800) } catch (_: Exception) {}
        }
        slot.writerThread = null
    }

    private fun writerLoop(slot: Slot) {
        val track = slot.track ?: return
        var silenceWritten = false

        while (slot.writerRunning.get() && running) {
            // 1) معالجة الـ pad (صمت للمحاذاة + trim)
            if (slot.padFrames > 0) {
                var left = slot.padFrames
                while (left > 0 && slot.writerRunning.get()) {
                    val frames = minOf(left, 1024)
                    val silence = ByteArray(frames * frameBytes)
                    val written = try {
                        track.write(silence, 0, silence.size, AudioTrack.WRITE_BLOCKING)
                    } catch (e: Exception) {
                        Log.w("MultiAudioEngine", "pad write failed", e)
                        -1
                    }
                    if (written <= 0) {
                        // إذا فشل، انتظر قليلاً
                        try { Thread.sleep(5) } catch (_: Exception) {}
                        slot.writerErrorCount++
                        if (slot.writerErrorCount > 20) {
                            Log.w("MultiAudioEngine", "too many pad write errors, breaking")
                            break
                        }
                        continue
                    }
                    left -= written / frameBytes
                    slot.writerErrorCount = 0
                }
                slot.padFrames = max(0, left)
                if (slot.padFrames == 0) silenceWritten = true
                else continue
            }

            // 2) معالجة leftover
            var toWrite: ByteArray? = null
            var offset = 0
            var length = 0

            synchronized(slot.queueLock) {
                if (slot.leftover != null) {
                    toWrite = slot.leftover
                    offset = slot.leftoverOffset
                    length = (toWrite!!.size - offset)
                } else if (slot.queue.isNotEmpty()) {
                    toWrite = slot.queue.removeFirst()
                    offset = 0
                    length = toWrite!!.size
                } else {
                    // لا بيانات، انتظر
                    try { slot.queueLock.wait(20) } catch (_: Exception) {}
                }
            }

            if (toWrite == null) continue

            var currentOffset = offset
            var remaining = length
            val data = toWrite!!

            while (remaining > 0 && slot.writerRunning.get() && running) {
                val chunk = min(remaining, 8192) // كتابة بقطع صغيرة لتجنب حجب طويل
                val written = try {
                    track.write(data, currentOffset, chunk, AudioTrack.WRITE_BLOCKING)
                } catch (e: Exception) {
                    Log.w("MultiAudioEngine", "write failed for ${slot.route.target.name}", e)
                    -1
                }
                if (written <= 0) {
                    // احتفظ بالباقي كـ leftover وحاول لاحقاً
                    synchronized(slot.queueLock) {
                        slot.leftover = data
                        slot.leftoverOffset = currentOffset
                    }
                    try { Thread.sleep(8) } catch (_: Exception) {}
                    slot.writerErrorCount++
                    if (slot.writerErrorCount > 30) {
                        Log.e("MultiAudioEngine", "writer too many errors, giving up for ${slot.route.target.name}")
                        listener?.onError("انقطع الصوت عن «${slot.route.target.name}». سيُعاد المحاولة.")
                        // حاول إعادة إنشاء المسار لاحقاً
                        break
                    }
                    break
                } else {
                    currentOffset += written
                    remaining -= written
                    slot.writerErrorCount = 0
                    if (remaining <= 0) {
                        synchronized(slot.queueLock) {
                            if (slot.leftover === data) {
                                slot.leftover = null
                                slot.leftoverOffset = 0
                            }
                        }
                    } else {
                        synchronized(slot.queueLock) {
                            slot.leftover = data
                            slot.leftoverOffset = currentOffset
                        }
                    }
                }
            }
        }
    }

    private fun alignPads() {
        val live = slots.filter { it.track != null && it.route.enabled }
        if (live.isEmpty()) {
            maxLatencyFrames = 0
            return
        }
        val maxLatency = live.maxOfOrNull { it.latencyFrames } ?: 0
        maxLatencyFrames = maxLatency
        for (slot in live) {
            if (slot.aligned) continue
            val base = max(0, maxLatency - slot.latencyFrames)
            val trim = (slot.route.trimMs * sampleRate) / 1000
            slot.padFrames = base + trim
            slot.aligned = true
        }
    }

    private fun basePad(slot: Slot): Int {
        val live: List<Slot>
        synchronized(lock) { live = slots.filter { it.track != null && it.route.enabled } }
        val maxLatency = live.maxOfOrNull { it.latencyFrames } ?: 0
        return max(0, maxLatency - slot.latencyFrames)
    }

    private fun startTracks() {
        synchronized(lock) {
            for (slot in slots) {
                val track = slot.track ?: continue
                if (!slot.route.enabled) continue
                if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
                    try {
                        track.play()
                        // بعد play، حاول مرة أخرى ضبط الجهاز المفضل (بعض الأجهزة تحتاج)
                        val device = slot.route.target.device
                        if (device != null) {
                            try { track.setPreferredDevice(device) } catch (_: Exception) {}
                        }
                    } catch (e: Exception) {
                        Log.w("MultiAudioEngine", "track.play failed", e)
                    }
                }
                // تأكد من أن الكاتب يعمل
                if (!slot.writerRunning.get()) startWriter(slot)
            }
        }
    }

    private fun applyVolumes() {
        synchronized(lock) {
            for (slot in slots) {
                val track = slot.track ?: continue
                try {
                    track.setVolume((slot.route.gain * master).coerceIn(0f, 1f))
                } catch (_: Exception) {}
            }
        }
    }

    private fun releaseSlot(slot: Slot) {
        stopWriter(slot)
        val track = slot.track
        if (track != null) {
            try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause() } catch (_: Exception) {}
            try { track.flush() } catch (_: Exception) {}
            try { track.stop() } catch (_: Exception) {}
            try { track.release() } catch (_: Exception) {}
        }
        slot.track = null
        slot.padFrames = 0
        slot.aligned = false
        slot.clearQueue()
    }

    private fun releaseCodec() {
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        codec = null
        try { extractor?.release() } catch (_: Exception) {}
        extractor = null
    }

    private fun latencyMillis(): Long {
        return (maxLatencyFrames * 1000L) / max(1, sampleRate)
    }

    private fun joinThread() {
        val current = thread ?: return
        try { current.join(1500) } catch (_: Exception) {}
        thread = null
    }

    private fun cleanup() {
        // إيقاف الكتاب فقط، لا تمسح القائمة نهائياً إلا في stop
        synchronized(lock) {
            for (slot in slots) stopWriter(slot)
        }
        releaseCodec()
        running = false
    }
}
