package com.nanjawi.majlis

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.nanjawi.majlis.audio.MultiAudioEngine
import com.nanjawi.majlis.audio.RouteConfig

/** يبقي التشغيل حيًا عند إطفاء الشاشة أو الخروج من الواجهة. */
class PlayerService : Service() {

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
            mainHandler.post { deviceListener?.invoke() }
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
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> {
                if (engine.isPlaying()) engine.pause() else engine.play()
                updateNotification()
            }
            ACTION_STOP -> {
                engine.stop()
                updateNotification()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        try {
            audioManager?.unregisterAudioDeviceCallback(deviceCallback)
        } catch (_: Exception) {
            /* تجاهل */
        }
        engine.stop()
        super.onDestroy()
    }

    // -------------------------------------------------------------- واجهة

    fun setSource(uri: Uri, name: String) {
        engine.setSource(uri, name)
    }

    fun setRoutes(routes: List<RouteConfig>) {
        engine.setRoutes(routes)
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
            description = "تشغيل الصوت على كل السماعات المفعّلة"
            setSound(null, null)
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
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sound)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(
                if (playing) "يعزف الآن على كل السماعات المفعّلة"
                else "متوقف — اضغط تشغيل"
            )
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(R.drawable.ic_stat_sound, if (playing) "إيقاف مؤقت" else "تشغيل", toggleIntent)
            .addAction(R.drawable.ic_stat_sound, "إيقاف", stopIntent)
            .build()
    }
}
