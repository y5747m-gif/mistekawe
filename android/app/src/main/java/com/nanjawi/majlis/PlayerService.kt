package com.nanjawi.majlis

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.nanjawi.majlis.audio.MultiAudioEngine
import com.nanjawi.majlis.audio.RouteConfig

/** يبقي التشغيل حيًا عند إطفاء الشاشة أو الخروج من الواجهة مع معالجة قوية للصوت. */
class PlayerService : Service(), AudioManager.OnAudioFocusChangeListener {

    companion object {
        const val CHANNEL_ID = "majlis_playback"
        const val NOTIFICATION_ID = 41
        const val ACTION_TOGGLE = "com.nanjawi.majlis.action.TOGGLE"
        const val ACTION_STOP = "com.nanjawi.majlis.action.STOP"
    }

    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var audioManager: AudioManager? = null
    private var deviceListener: (() -> Unit)? = null
    private var errorListener: ((String) -> Unit)? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false
    private var noisyReceiverRegistered = false

    lateinit var engine: MultiAudioEngine
        private set

    inner class LocalBinder : Binder() {
        fun service(): PlayerService = this@PlayerService
    }

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
            mainHandler.post { deviceListener?.invoke() }
        }

        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
            // إذا انقطعت سماعة أثناء التشغيل، أبلغ الواجهة لتحديث القائمة
            mainHandler.post { deviceListener?.invoke() }
        }
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                // لا نوقف كل شيء، فقط نبلغ. المستخدم قد يكون فصل سماعة سلكية.
                // لكن إذا كان التشغيل يعتمد على سماعة سلكية فقط، يمكن إيقافه مؤقتاً.
                // نترك القرار للمحرك.
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        engine = MultiAudioEngine(applicationContext)
        engine.setListener(object : MultiAudioEngine.Listener {
            override fun onError(message: String) {
                mainHandler.post { errorListener?.invoke(message) }
            }
        })
        createChannel()
        audioManager = getSystemService(AudioManager::class.java)
        audioManager?.registerAudioDeviceCallback(deviceCallback, mainHandler)

        // WakeLock لمنع توقف المعالج عند إطفاء الشاشة
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "majlis:playback")
            wakeLock?.setReferenceCounted(false)
        } catch (_: Exception) {}

        // تسجيل مستمع الضوضاء
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
            }
            noisyReceiverRegistered = true
        } catch (_: Exception) {}

        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> {
                if (engine.isPlaying()) {
                    engine.pause()
                    abandonFocus()
                    releaseWakeLock()
                } else {
                    if (requestFocus()) {
                        acquireWakeLock()
                        engine.play()
                    } else {
                        engine.play()
                    }
                }
                updateNotification()
            }
            ACTION_STOP -> {
                engine.stop()
                abandonFocus()
                releaseWakeLock()
                updateNotification()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        try { audioManager?.unregisterAudioDeviceCallback(deviceCallback) } catch (_: Exception) {}
        try {
            if (noisyReceiverRegistered) unregisterReceiver(noisyReceiver)
        } catch (_: Exception) {}
        abandonFocus()
        releaseWakeLock()
        engine.stop()
        super.onDestroy()
    }

    // -------------------------------------------------------------- واجهة

    fun setSource(uri: Uri, name: String) {
        engine.setSource(uri, name)
        updateNotification()
    }

    fun setRoutes(routes: List<RouteConfig>) {
        engine.setRoutes(routes)
        updateNotification()
    }

    fun setGain(key: String, gain: Float) = engine.setGain(key, gain)
    fun setTrim(key: String, trimMs: Int) = engine.setTrim(key, trimMs)

    fun onDevicesChanged(listener: () -> Unit) {
        deviceListener = listener
    }

    fun onError(listener: (String) -> Unit) {
        errorListener = listener
    }

    fun updateNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification(engine.isPlaying()))
    }

    fun playWithFocus(): Boolean {
        if (requestFocus()) {
            acquireWakeLock()
            engine.play()
            updateNotification()
            return true
        }
        // حتى لو فشل طلب التركيز، نحاول التشغيل
        engine.play()
        updateNotification()
        return false
    }

    fun pauseWithFocus() {
        engine.pause()
        abandonFocus()
        releaseWakeLock()
        updateNotification()
    }

    // ----------------------------------------------------------- التركيز والطاقة

    private fun requestFocus(): Boolean {
        val manager = audioManager ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(this, mainHandler)
                    .build()
                focusRequest = req
                val res = manager.requestAudioFocus(req)
                hasFocus = res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                hasFocus
            } else {
                @Suppress("DEPRECATION")
                val res = manager.requestAudioFocus(
                    this,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                )
                hasFocus = res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                hasFocus
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun abandonFocus() {
        val manager = audioManager ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { manager.abandonAudioFocusRequest(it) }
                focusRequest = null
            } else {
                @Suppress("DEPRECATION")
                manager.abandonAudioFocus(this)
            }
        } catch (_: Exception) {}
        hasFocus = false
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                mainHandler.post {
                    engine.pause()
                    releaseWakeLock()
                    updateNotification()
                    errorListener?.invoke("توقف الصوت لأن تطبيقًا آخر أخذ التركيز.")
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                mainHandler.post {
                    if (engine.isPlaying()) {
                        engine.pause()
                        updateNotification()
                    }
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                mainHandler.post {
                    engine.setMaster(0.25f)
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                mainHandler.post {
                    engine.setMaster(0.85f)
                    // لا نستأنف تلقائياً إذا كان المستخدم أوقف
                }
            }
        }
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock?.isHeld == false) wakeLock?.acquire(4 * 60 * 60 * 1000L) // 4 ساعات كحد أقصى
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {}
    }

    // ----------------------------------------------------------- الإشعار

    private fun startAsForeground() {
        val notification = buildNotification(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "تشغيل الصوت على كل السماعات المفعّلة مع منع التقطيع"
            setSound(null, null)
            enableVibration(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(playing: Boolean): Notification {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), flags
        )
        val toggleIntent = PendingIntent.getService(
            this, 1, Intent(this, PlayerService::class.java).setAction(ACTION_TOGGLE), flags
        )
        val stopIntent = PendingIntent.getService(
            this, 2, Intent(this, PlayerService::class.java).setAction(ACTION_STOP), flags
        )
        val state = engine.state()
        val active = state.activeOutputs
        val text = if (playing) {
            if (active > 1) "يعزف الآن على $active سماعات معًا بدون تقطيع"
            else "يعزف الآن"
        } else {
            "متوقف — اضغط تشغيل"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sound)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSubText(if (state.sourceName.isNotBlank()) state.sourceName else null)
            .setContentIntent(openIntent)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(R.drawable.ic_stat_sound, if (playing) "إيقاف مؤقت" else "تشغيل", toggleIntent)
            .addAction(R.drawable.ic_stat_sound, "إيقاف", stopIntent)
            .build()
    }
}
