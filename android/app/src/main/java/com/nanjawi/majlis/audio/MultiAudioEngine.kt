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
 * - ضغط عكسي (backpressure): فك الترميز ينتظر حتى تستهلك السماعات،
 *   ولا يُحذف أي مقطع صوتي إطلاقًا — هذا ما يمنع «قفز» الأغنية للأمام.
 * - الموضع الظاهر يُحسب من الصوت المسموع فعلًا (المكتوب ناقص ما لم يُسمع بعد)،
 *   لا من سرعة فك الترميز.
 * - الإيقاف المؤقت والاستئناف والانتقال يتمون بلا قفز ولا تداخل صوت قديم.
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
    @Volatile private var playBaseUs = 0L

    private var eosReached = false
    private var sawInputEos = false
    @Volatile private var pendingRestartUs: Long? = null
    @Volatile private var pendingRecreate = false

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

        // طابور مستقل لكل مخرج — محدود بالبايتات، ولا يُحذف منه شيء أبدًا
        val queue: ArrayDeque<ByteArray> = ArrayDeque()
        val queueLock = Object()
        var pendingBytes: Int = 0          // بايتات ما زالت في الطابور تنتظر الكتابة
        var capacityBytes: Int = 256 * 1024 // تُضبط لاحقًا ≈ 1.5 ثانية من الصوت
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
                pendingBytes = 0
                queueLock.notifyAll() // أيقظ المنتج إن كان ينتظر مكانًا
            }
        }

        fun hasPendingAudio(): Boolean {
            synchronized(queueLock) { return queue.isNotEmpty() || leftover != null }
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
        playBaseUs = 0L
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
                    val oldTrim = slot.route.trimMs
                    slot.route.trimMs = trimMs
                    if (running) {
                        // أثناء التشغيل طبّق الفرق فقط. إعادة إدخال صمت المحاذاة
                        // كاملًا كانت تُسكت السماعة ثم تعيدها فجأة (قفزة مسموعة).
                        val deltaFrames = ((trimMs - oldTrim) * sampleRate) / 1000
                        if (slot.aligned) {
                            slot.padFrames = max(0, slot.padFrames + deltaFrames)
                        } else {
                            alignPads()
                        }
                    } else {
                        slot.padFrames = basePad(slot) + (trimMs * sampleRate) / 1000
                        slot.aligned = false
                    }
                }
            }
            if (!running && slots.any { !it.aligned }) alignPads()
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
        // بعد نهاية طبيعية، زر التشغيل يعيد من البداية لا من النهاية
        if (durationUs > 0 && startUs >= durationUs - 50_000L) startUs = 0L
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
        // انتقال لم يُنفّذ بعد؟ خذ هدفه موضعًا للإيقاف بدل الموضع القديم
        val pending = pendingRestartUs
        pendingRestartUs = null
        pendingRecreate = false
        // والا فالتقط الموضع المسموع الفعلي قبل الإيقاف — لا بعده ولا من عدّاد فك الترميز.
        val playedMs = if (pending != null) pending / 1000L else currentPositionMs()
        running = false
        joinThread()
        synchronized(lock) { stopAllTracksKeepSlots() }
        releaseCodec()
        startUs = max(0L, playedMs) * 1000L
        playBaseUs = startUs
        audioBytesWritten = 0L
    }

    fun stop() {
        running = false
        joinThread()
        // إيقاف كل الخيوط والمسارات مع الحفاظ على قائمة الـ slots لإعادة الاستخدام
        synchronized(lock) { stopAllTracksKeepSlots() }
        releaseCodec()
        startUs = 0L
        playBaseUs = 0L
        audioBytesWritten = 0L
        pendingRestartUs = null
        pendingRecreate = false
    }

    // نسخة stop تحافظ على الـ slots (تُستخدم من pause)
    private fun stopAllTracksKeepSlots() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) {
            // أوقف الصوت أولًا: ذلك يفكّ أي كتابة محجوبة فيكمل الكاتب الخروج بسرعة
            val track = slot.track
            if (track != null) {
                try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause() } catch (_: Exception) {}
            }
            stopWriter(slot)
            if (track != null) {
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
            playBaseUs = startUs
            audioBytesWritten = 0L
            pendingRestartUs = null
            pendingRecreate = false
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
        val position = if (running) {
            currentPositionMs()
        } else {
            startUs / 1000L
        }
        val active: Int
        synchronized(lock) { active = slots.count { it.route.enabled } }
        return State(running, position.coerceIn(0L, duration), duration, active, sourceName)
    }

    /**
     * الموضع = نقطة البدء + (الصوت الذي سُلّم للسماعات − ما لم يُسمع بعد).
     * «ما لم يُسمع بعد» = الطوابير + بقايا المقاطع + مخازن الصوت الداخلية،
     * ونأخذ أكبر تراكم بين السماعات حتى لا يتقدم العدّاد على أبطأ سماعة.
     * سماعة التحقت متأخرًا أو ميت كاتبها لا تُدخل في الحساب فلا تسحب الموضع للخلف.
     */
    private fun currentPositionMs(): Long {
        val baseMs = max(0L, playBaseUs / 1000L)
        if (audioBytesWritten <= 0L) return baseMs
        var maxBacklogBytes = 0L
        var any = false
        synchronized(lock) {
            for (slot in slots) {
                if (!slot.route.enabled || slot.track == null || !slot.writerRunning.get()) continue
                any = true
                var backlog: Long
                synchronized(slot.queueLock) {
                    backlog = slot.pendingBytes.toLong()
                    val lo = slot.leftover
                    if (lo != null) backlog += (lo.size - slot.leftoverOffset).toLong()
                }
                backlog += slot.latencyFrames.toLong() * frameBytes
                if (backlog > maxBacklogBytes) maxBacklogBytes = backlog
            }
        }
        if (!any) return baseMs
        val playedBytes = audioBytesWritten - maxBacklogBytes
        val frames = if (playedBytes > 0) playedBytes / frameBytes else 0L
        return baseMs + (frames * 1000L) / max(1, sampleRate)
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
            // المهلة بالميكروثانية: 10ms تكفي لتخفيف حرارة المعالج دون تخلف الجدولة
            val index = decoder.dequeueOutputBuffer(info, 10_000)
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
                // انتظر حتى تسمع السماعات ذيل المقطع فعلًا — لا تحذف ما بقي في الطوابير
                waitForQueuesToDrain()
                if (!running) break
                if (pendingRestartUs != null) continue // المستخدم انتقل أثناء التصريف
                Thread.sleep(latencyMillis() + 120L)
                if (!running) break
                if (pendingRestartUs != null) continue // الانتقال الجديد له الأولوية على إعادة اللف
                if (looping) {
                    pendingRestartUs = 0L
                    pendingRecreate = false
                } else {
                    // النهاية الطبيعية: أظهر الموضع عند آخر المدة فلا «يقفز» العدّاد للصفر
                    startUs = durationUs
                    playBaseUs = durationUs
                    running = false
                }
            }
        }
    }

    /**
     * انتظر حتى تستهلك السماعات كل ما في طوابيرها.
     * يستجيب فورًا للإيقاف أو طلب انتقال جديد.
     */
    private fun waitForQueuesToDrain(timeoutMs: Long = 6000L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (running && pendingRestartUs == null && System.currentTimeMillis() < deadline) {
            var pending = false
            synchronized(lock) {
                for (slot in slots) {
                    if (!slot.route.enabled || slot.track == null || !slot.writerRunning.get()) continue
                    if (slot.hasPendingAudio()) { pending = true; break }
                }
            }
            if (!pending) return
            try { Thread.sleep(25) } catch (_: InterruptedException) {}
        }
    }

    private fun restart(atUs: Long, recreate: Boolean) {
        if (recreate) {
            // 1) أوقف الصوت أولًا فيفك أي كتابة محجوبة
            pauseLiveTracks()
            // 2) نظّف الطوابير والمحاذاة
            synchronized(lock) {
                for (slot in slots) {
                    slot.clearQueue()
                    slot.padFrames = 0
                    slot.aligned = false
                }
            }
            // 3) أوقف خيوط الكتابة بهدوء
            stopWritersOnly()
            // 4) افرغ مخازن الصوت حتى لا يُسمع صوت ما قبل الانتقال بعده (تداخل/قفزة)
            flushLiveTracks()
        } else {
            synchronized(lock) { for (slot in slots) slot.clearQueue() }
        }
        audioBytesWritten = 0L
        playBaseUs = atUs
        eosReached = false
        createDecoder(atUs)
        primeFormat()
        if (recreate) {
            ensureTracks()
            startTracks()
        }
        applyVolumes()
    }

    private fun pauseLiveTracks() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) {
            val track = slot.track ?: continue
            try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause() } catch (_: Exception) {}
        }
    }

    private fun flushLiveTracks() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) {
            val track = slot.track ?: continue
            try { track.flush() } catch (_: Exception) {}
        }
    }

    private fun stopWritersOnly() {
        val copy: List<Slot>
        synchronized(lock) { copy = ArrayList(slots) }
        for (slot in copy) stopWriter(slot)
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
            val index = decoder.dequeueOutputBuffer(info, 10_000)
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
        val index = decoder.dequeueInputBuffer(10_000)
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

    /**
     * يوزّع مقطع الصوت على كل السماعات دون حذف أي شيء.
     * إذا امتلأ طابور سماعة، ينتظر المنتج حتى تستهلكها — هذا الضغط العكسي
     * يجعل فك الترميز يتبع الزمن الحقيقي للتشغيل، فلا تتقدم القراءة على السمع
     * ولا «تقفز» الأغنية أبدًا.
     */
    private fun writeAllEnqueue(data: ByteArray) {
        val snapshot: List<Slot>
        synchronized(lock) { snapshot = ArrayList(slots) }
        var delivered = false
        for (slot in snapshot) {
            if (!slot.route.enabled) continue
            if (slot.track == null) continue
            // كاتب ميت لا يستهلك شيئًا: تخطَّه حتى لا يوقف بقية السماعات
            if (!slot.writerRunning.get()) continue

            synchronized(slot.queueLock) {
                while (running &&
                    pendingRestartUs == null &&
                    slot.track != null &&
                    slot.writerRunning.get() &&
                    slot.pendingBytes > 0 &&
                    slot.pendingBytes + data.size > slot.capacityBytes
                ) {
                    try { slot.queueLock.wait(40) } catch (_: InterruptedException) {}
                }
                // طلب انتقال أو إيقاف: المقطع المتبقي من الموضع القديم لم يعد مطلوبًا
                if (!running || pendingRestartUs != null) return
                slot.queue.addLast(data)
                slot.pendingBytes += data.size
                slot.queueLock.notifyAll()
            }
            delivered = true
        }
        if (delivered) {
            audioBytesWritten += data.size
        } else {
            // لا سماعة حيّة تستهلك حاليًا: لا تحرق المعالج بفك ترميز فارغ
            try { Thread.sleep(50) } catch (_: InterruptedException) {}
        }
    }

    // ------------------------------------------------------------- المسارات

    private fun ensureTracks() {
        synchronized(lock) { alignPads() }
        // ابنِ المسارات الناقصة خارج القفل
        val toBuild: List<Slot>
        synchronized(lock) { toBuild = slots.filter { it.route.enabled && it.track == null } }
        for (slot in toBuild) {
            val track = buildTrack(slot) ?: continue
            synchronized(lock) {
                slot.track = track
                alignPads()
            }
        }
        // أطلق مسارات المعطّلة
        val disabled: List<Slot>
        synchronized(lock) { disabled = slots.filter { !it.route.enabled && it.track != null } }
        for (slot in disabled) releaseSlot(slot)
        // إعادة مواءمة بعد البناء
        synchronized(lock) { alignPads() }
    }

    private fun queueCapacityBytes(): Int {
        // نحو 1.5 ثانية من الصوت الخام: تكفي لامتصاص تذبذب السماعات دون حذف
        val perSecond = max(1, sampleRate) * max(1, frameBytes)
        val desired = perSecond + perSecond / 2
        return desired.coerceIn(96 * 1024, 384 * 1024)
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

            slot.latencyFrames = bufferSize / max(1, frameBytes)
            slot.capacityBytes = queueCapacityBytes()
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
                if (slot.padFrames > 0) continue
            }

            // 2) خذ مقطعًا من الطابور (مع بقايا المقطع السابق)
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
                    slot.pendingBytes = max(0, slot.pendingBytes - toWrite!!.size)
                    slot.queueLock.notifyAll() // أيقظ المنتج: توفّر مكان في الطابور
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
                slot.capacityBytes = queueCapacityBytes()
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
        // أوقف الصوت أولًا لفك أي كتابة محجوبة ثم أوقف الكاتب
        val track = slot.track
        if (track != null) {
            try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause() } catch (_: Exception) {}
        }
        stopWriter(slot)
        if (track != null) {
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
