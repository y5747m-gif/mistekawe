package com.nanjawi.majlis

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.OpenableColumns
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.nanjawi.majlis.audio.DemoTrack
import com.nanjawi.majlis.audio.OutputScanner
import com.nanjawi.majlis.audio.RouteConfig

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var service: PlayerService? = null
    private var bound = false
    private var seeking = false

    private val routes = ArrayList<RouteConfig>()
    private lateinit var adapter: DeviceAdapter

    private lateinit var statusText: TextView
    private lateinit var trackName: TextView
    private lateinit var timeNow: TextView
    private lateinit var timeTotal: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var playBtn: MaterialButton
    private lateinit var emptyText: TextView
    private lateinit var list: RecyclerView

    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: Exception) {
            /* الملف قد لا يقبل الإذن الدائم */
        }
        val name = displayName(uri)
        prefs.edit()
            .putString(KEY_FILE, uri.toString())
            .putString(KEY_FILE_NAME, name)
            .apply()
        service?.setSource(uri, name)
        updatePlayerUi()
    }

    private val requestPerms = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshDevices()
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val local = binder as? PlayerService.LocalBinder ?: return
            service = local.service()
            bound = true
            service?.onDevicesChanged { handler.post { refreshDevices() } }
            service?.onError { message ->
                handler.post { Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show() }
            }
            restoreSource()
            refreshDevices()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            bound = false
            service = null
        }
    }

    private val ticker = object : Runnable {
        override fun run() {
            handler.postDelayed(this, 250)
            val state = service?.engine?.state() ?: return
            timeNow.text = format(state.positionMs)
            timeTotal.text = format(state.durationMs)
            if (!seeking && state.durationMs > 0) {
                seekBar.progress = ((state.positionMs * 1000L) / state.durationMs).toInt()
            }
            playBtn.text = if (state.playing) getString(R.string.pause) else getString(R.string.play)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("majlis", MODE_PRIVATE)

        statusText = findViewById(R.id.statusText)
        trackName = findViewById(R.id.trackName)
        timeNow = findViewById(R.id.timeNow)
        timeTotal = findViewById(R.id.timeTotal)
        seekBar = findViewById(R.id.seekBar)
        playBtn = findViewById(R.id.playBtn)
        emptyText = findViewById(R.id.emptyText)
        list = findViewById(R.id.devicesList)

        adapter = DeviceAdapter()
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        findViewById<MaterialButton>(R.id.playBtn).setOnClickListener {
            val engine = service?.engine ?: return@setOnClickListener
            if (engine.isPlaying()) engine.pause() else engine.play()
            service?.updateNotification()
            adapter.notifyDataSetChanged()
        }

        findViewById<MaterialButton>(R.id.pickFileBtn).setOnClickListener {
            pickFile.launch(arrayOf("audio/*"))
        }

        findViewById<MaterialButton>(R.id.refreshBtn).setOnClickListener {
            refreshDevices()
            Toast.makeText(this, "تم تحديث قائمة السماعات", Toast.LENGTH_SHORT).show()
        }

        findViewById<MaterialButton>(R.id.allBtn).setOnClickListener {
            for (route in routes) {
                route.enabled = true
                prefs.edit().putBoolean("on:${route.target.key}", true).apply()
            }
            adapter.notifyDataSetChanged()
            pushRoutes()
            updateStatus()
        }

        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                if (fromUser) seeking = true
            }

            override fun onStartTrackingTouch(bar: SeekBar) {
                seeking = true
            }

            override fun onStopTrackingTouch(bar: SeekBar) {
                val duration = service?.engine?.durationMs() ?: 0L
                if (duration > 0) service?.engine?.seek((bar.progress * duration) / 1000L)
                seeking = false
            }
        })

        askPermissions()
        val intent = Intent(this, PlayerService::class.java)
        ContextCompat.startForegroundService(this, intent)
        bindService(intent, connection, BIND_AUTO_CREATE)
        handler.post(ticker)
    }

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        if (bound) {
            unbindService(connection)
            bound = false
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------- المسارات

    private fun refreshDevices() {
        val found = OutputScanner.scan(this)
        val next = found.map { target ->
            val old = routes.firstOrNull { it.target.key == target.key }
            RouteConfig(
                target = target,
                gain = old?.gain ?: prefs.getFloat("gain:${target.key}", 0.85f),
                trimMs = old?.trimMs ?: prefs.getInt("trim:${target.key}", 0),
                enabled = old?.enabled ?: prefs.getBoolean("on:${target.key}", true)
            )
        }
        routes.clear()
        routes.addAll(next)
        adapter.notifyDataSetChanged()
        emptyText.visibility = if (routes.isEmpty()) View.VISIBLE else View.GONE
        pushRoutes()
        updateStatus()
    }

    private fun pushRoutes() {
        service?.setRoutes(routes)
    }

    private fun restoreSource() {
        if (service?.engine?.hasSource() == true) {
            updatePlayerUi()
            return
        }
        val saved = prefs.getString(KEY_FILE, null)
        if (saved != null) {
            service?.setSource(
                Uri.parse(saved),
                prefs.getString(KEY_FILE_NAME, "ملف صوتي") ?: "ملف صوتي"
            )
            updatePlayerUi()
            return
        }
        trackName.text = getString(R.string.demo_track)
        Thread {
            val demo = DemoTrack.file(applicationContext)
            handler.post {
                service?.setSource(Uri.fromFile(demo), getString(R.string.demo_track))
                updatePlayerUi()
            }
        }.start()
    }

    private fun updatePlayerUi() {
        val state = service?.engine?.state()
        trackName.text = state?.sourceName?.ifBlank { getString(R.string.no_file) }
            ?: getString(R.string.no_file)
    }

    private fun updateStatus() {
        val enabled = routes.count { it.enabled }
        val bt = routes.count {
            it.enabled && it.target.device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
        }
        statusText.text = when {
            routes.isEmpty() ->
                "لا توجد مخارج صوت ظاهرة. اربط سماعة بلوتوث من إعدادات الهاتف، ثم اضغط «تحديث السماعات»."

            enabled == 0 ->
                "فعّل مخرجًا واحدًا على الأقل بالأسفل لتسمع الصوت."

            bt >= 2 ->
                "جاهز. الصوت سيخرج من $enabled مخرجًا معًا، منها $bt سماعات بلوتوث في الوقت نفسه."

            bt == 1 ->
                "جاهز. $enabled مخرج مفعّل. لإضافة سماعة ثانية: اربطها من إعدادات الهاتف ثم اضغط «تحديث السماعات»."

            else ->
                "جاهز. $enabled مخرج مفعّل (مكبر الهاتف حاليًا). اربط سماعة بلوتوث من إعدادات الهاتف ليظهر اسمها هنا."
        }
    }

    // --------------------------------------------------------------- أدوات

    private fun askPermissions() {
        val needed = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) requestPerms.launch(missing.toTypedArray())
    }

    private fun displayName(uri: Uri): String {
        var result: String? = null
        val cursor = contentResolver.query(uri, null, null, null, null)
        cursor?.use {
            val index = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && it.moveToFirst()) result = it.getString(index)
        }
        return result ?: uri.lastPathSegment ?: "ملف صوتي"
    }

    private fun format(ms: Long): String {
        val total = if (ms < 0) 0 else ms / 1000
        val minutes = total / 60
        val seconds = total % 60
        return "$minutes:${seconds.toString().padStart(2, '0')}"
    }

    // -------------------------------------------------------------- القائمة

    private inner class DeviceAdapter : RecyclerView.Adapter<DeviceAdapter.Holder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_device, parent, false)
            return Holder(view)
        }

        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(routes[position])

        override fun getItemCount(): Int = routes.size

        inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
            private val switch: SwitchCompat = view.findViewById(R.id.enableSwitch)
            private val name: TextView = view.findViewById(R.id.deviceName)
            private val meta: TextView = view.findViewById(R.id.deviceMeta)
            private val badge: TextView = view.findViewById(R.id.liveBadge)
            private val volume: SeekBar = view.findViewById(R.id.volumeBar)
            private val delay: SeekBar = view.findViewById(R.id.delayBar)

            fun bind(route: RouteConfig) {
                val target = route.target
                name.text = target.name
                meta.text = if (target.address.isBlank()) target.kind else "${target.kind} · ${target.address}"

                switch.setOnCheckedChangeListener(null)
                switch.isChecked = route.enabled
                switch.setOnCheckedChangeListener { _, checked ->
                    route.enabled = checked
                    prefs.edit().putBoolean("on:${target.key}", checked).apply()
                    pushRoutes()
                    updateStatus()
                }

                volume.setOnSeekBarChangeListener(null)
                volume.progress = (route.gain * 100).toInt().coerceIn(0, 100)
                volume.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                        if (!fromUser) return
                        route.gain = value / 100f
                        prefs.edit().putFloat("gain:${target.key}", route.gain).apply()
                        service?.setGain(target.key, route.gain)
                    }

                    override fun onStartTrackingTouch(bar: SeekBar) {}
                    override fun onStopTrackingTouch(bar: SeekBar) {}
                })

                delay.setOnSeekBarChangeListener(null)
                delay.progress = route.trimMs.coerceIn(0, 300)
                delay.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                        if (!fromUser) return
                        route.trimMs = value
                        prefs.edit().putInt("trim:${target.key}", value).apply()
                        service?.setTrim(target.key, value)
                    }

                    override fun onStartTrackingTouch(bar: SeekBar) {}
                    override fun onStopTrackingTouch(bar: SeekBar) {}
                })

                val playing = service?.engine?.isPlaying() ?: false
                badge.visibility = if (playing && route.enabled) View.VISIBLE else View.GONE
            }
        }
    }

    companion object {
        private const val KEY_FILE = "source_uri"
        private const val KEY_FILE_NAME = "source_name"
    }
}
