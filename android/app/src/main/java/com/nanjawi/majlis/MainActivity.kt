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
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
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
import com.nanjawi.majlis.audio.AudioFile
import com.nanjawi.majlis.audio.DemoTrack
import com.nanjawi.majlis.audio.MediaLibraryScanner
import com.nanjawi.majlis.audio.OutputScanner
import com.nanjawi.majlis.audio.RouteConfig

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var service: PlayerService? = null
    private var bound = false
    private var seeking = false

    private val routes = ArrayList<RouteConfig>()
    private lateinit var deviceAdapter: DeviceAdapter

    // مكتبة الصوت
    private val allAudioFiles = ArrayList<AudioFile>()
    private val filteredAudioFiles = ArrayList<AudioFile>()
    private lateinit var audioAdapter: AudioAdapter
    private var currentSort = SortBy.TITLE

    private lateinit var statusText: TextView
    private lateinit var trackName: TextView
    private lateinit var timeNow: TextView
    private lateinit var timeTotal: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var playBtn: MaterialButton
    private lateinit var emptyText: TextView
    private lateinit var devicesList: RecyclerView

    private lateinit var libraryCountText: TextView
    private lateinit var audioList: RecyclerView
    private lateinit var libraryEmptyText: TextView
    private lateinit var searchEdit: EditText
    private lateinit var grantPermissionBtn: MaterialButton

    enum class SortBy { TITLE, ARTIST, DATE, DURATION }

    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {}
        val name = displayName(uri)
        prefs.edit().putString(KEY_FILE, uri.toString()).putString(KEY_FILE_NAME, name).apply()
        service?.setSource(uri, name)
        updatePlayerUi()
        Toast.makeText(this, "تم اختيار: $name", Toast.LENGTH_SHORT).show()
    }

    private val requestPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        val granted = results.values.any { it }
        if (granted) {
            refreshDevices()
            // إذا منح إذن الصوت، افحص المكتبة تلقائياً
            if (hasAudioPermission()) {
                grantPermissionBtn.visibility = View.GONE
                scanLibrary()
            }
        } else {
            updatePermissionUI()
        }
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
            // حاول استعادة المكتبة إذا كان هناك إذن
            if (hasAudioPermission() && allAudioFiles.isEmpty()) {
                scanLibrary()
            }
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
                seekBar.progress = ((state.positionMs * 1000L) / state.durationMs).toInt().coerceIn(0, 1000)
            }
            playBtn.text = if (state.playing) getString(R.string.pause) else getString(R.string.play)
            deviceAdapter.notifyDataSetChanged()
            audioAdapter.notifyDataSetChanged()
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
        devicesList = findViewById(R.id.devicesList)

        libraryCountText = findViewById(R.id.libraryCountText)
        audioList = findViewById(R.id.audioList)
        libraryEmptyText = findViewById(R.id.libraryEmptyText)
        searchEdit = findViewById(R.id.searchEdit)
        grantPermissionBtn = findViewById(R.id.grantPermissionBtn)

        deviceAdapter = DeviceAdapter()
        devicesList.layoutManager = LinearLayoutManager(this)
        devicesList.adapter = deviceAdapter

        audioAdapter = AudioAdapter()
        audioList.layoutManager = LinearLayoutManager(this)
        audioList.adapter = audioAdapter

        // أزرار المشغل
        findViewById<MaterialButton>(R.id.playBtn).setOnClickListener {
            val svc = service ?: return@setOnClickListener
            val engine = svc.engine
            if (engine.isPlaying()) {
                svc.pauseWithFocus()
            } else {
                val enabled = routes.count { it.enabled }
                if (enabled == 0) {
                    Toast.makeText(this, "فعّل سماعة واحدة على الأقل أولاً", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                svc.playWithFocus()
            }
            svc.updateNotification()
        }

        findViewById<MaterialButton>(R.id.pickFileBtn).setOnClickListener {
            pickFile.launch(arrayOf("audio/*"))
        }

        findViewById<MaterialButton>(R.id.refreshBtn).setOnClickListener {
            refreshDevices()
            Toast.makeText(this, "تم تحديث قائمة السماعات", Toast.LENGTH_SHORT).show()
        }

        findViewById<MaterialButton>(R.id.allBtn).setOnClickListener {
            val btRoutes = routes.filter { isBluetooth(it) }
            if (btRoutes.isNotEmpty()) {
                for (route in routes) {
                    val shouldEnable = isBluetooth(route)
                    route.enabled = shouldEnable
                    prefs.edit().putBoolean("on:${route.target.key}", shouldEnable).apply()
                }
                Toast.makeText(this, "تم تفعيل ${btRoutes.size} سماعات بلوتوث فقط", Toast.LENGTH_LONG).show()
            } else {
                for (route in routes) {
                    route.enabled = true
                    prefs.edit().putBoolean("on:${route.target.key}", true).apply()
                }
            }
            deviceAdapter.notifyDataSetChanged()
            pushRoutes()
            updateStatus()
        }

        // أزرار المكتبة
        findViewById<MaterialButton>(R.id.scanLibraryBtn).setOnClickListener {
            if (!hasAudioPermission()) {
                askAudioPermission()
            } else {
                scanLibrary()
            }
        }

        findViewById<MaterialButton>(R.id.refreshLibraryBtn).setOnClickListener {
            if (!hasAudioPermission()) {
                askAudioPermission()
            } else {
                scanLibrary()
            }
        }

        grantPermissionBtn.setOnClickListener { askAudioPermission() }

        findViewById<MaterialButton>(R.id.sortTitleBtn).setOnClickListener {
            currentSort = SortBy.TITLE
            applySortAndFilter()
        }
        findViewById<MaterialButton>(R.id.sortArtistBtn).setOnClickListener {
            currentSort = SortBy.ARTIST
            applySortAndFilter()
        }
        findViewById<MaterialButton>(R.id.sortDateBtn).setOnClickListener {
            currentSort = SortBy.DATE
            applySortAndFilter()
        }

        searchEdit.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { applySortAndFilter() }
        })

        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) { if (fromUser) seeking = true }
            override fun onStartTrackingTouch(bar: SeekBar) { seeking = true }
            override fun onStopTrackingTouch(bar: SeekBar) {
                val duration = service?.engine?.durationMs() ?: 0L
                if (duration > 0) service?.engine?.seek((bar.progress * duration) / 1000L)
                seeking = false
            }
        })

        askPermissions()
        updatePermissionUI()

        val intent = Intent(this, PlayerService::class.java)
        ContextCompat.startForegroundService(this, intent)
        bindService(intent, connection, BIND_AUTO_CREATE)
        handler.post(ticker)
    }

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        if (bound) { unbindService(connection); bound = false }
        super.onDestroy()
    }

    // ------------------------------------------------------------- الأذونات

    private fun hasAudioPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun askAudioPermission() {
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        requestPerms.launch(perms)
    }

    private fun askPermissions() {
        val needed = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
            needed.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            needed.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPerms.launch(missing.toTypedArray())
    }

    private fun updatePermissionUI() {
        if (hasAudioPermission()) {
            grantPermissionBtn.visibility = View.GONE
            libraryEmptyText.visibility = if (allAudioFiles.isEmpty()) View.VISIBLE else View.GONE
        } else {
            grantPermissionBtn.visibility = View.VISIBLE
            libraryCountText.text = getString(R.string.permission_needed)
            libraryEmptyText.visibility = View.VISIBLE
        }
    }

    // ------------------------------------------------------------- مكتبة MP3

    private fun scanLibrary() {
        libraryCountText.text = "جارٍ فحص جميع ملفات MP3 على الهاتف..."
        libraryEmptyText.visibility = View.GONE
        grantPermissionBtn.visibility = View.GONE

        Thread {
            val files = MediaLibraryScanner.scanAll(this)
            handler.post {
                allAudioFiles.clear()
                allAudioFiles.addAll(files)
                applySortAndFilter()
                val mp3Count = files.count { it.displayName.lowercase().endsWith(".mp3") }
                libraryCountText.text = if (mp3Count > 0) {
                    getString(R.string.library_mp3_count, mp3Count, files.size)
                } else {
                    getString(R.string.library_count, files.size)
                }
                if (files.isEmpty()) {
                    libraryEmptyText.visibility = View.VISIBLE
                    libraryEmptyText.text = "لم يتم العثور على ملفات صوت. تأكد أن لديك ملفات MP3 على الهاتف."
                } else {
                    libraryEmptyText.visibility = View.GONE
                    Toast.makeText(this, "تم العثور على ${files.size} ملف صوتي، منها $mp3Count MP3", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun applySortAndFilter() {
        val query = searchEdit.text.toString().trim().lowercase()
        val filtered = if (query.isBlank()) {
            ArrayList(allAudioFiles)
        } else {
            allAudioFiles.filter {
                it.title.lowercase().contains(query) ||
                it.artist.lowercase().contains(query) ||
                it.album.lowercase().contains(query) ||
                it.displayName.lowercase().contains(query)
            }
        }

        val sorted = when (currentSort) {
            SortBy.TITLE -> filtered.sortedBy { it.title.lowercase() }
            SortBy.ARTIST -> filtered.sortedBy { it.artist.lowercase() }
            SortBy.DATE -> filtered.sortedByDescending { it.dateAdded }
            SortBy.DURATION -> filtered.sortedByDescending { it.durationMs }
        }

        filteredAudioFiles.clear()
        filteredAudioFiles.addAll(sorted)
        audioAdapter.notifyDataSetChanged()

        if (filteredAudioFiles.isEmpty() && allAudioFiles.isNotEmpty()) {
            libraryEmptyText.visibility = View.VISIBLE
            libraryEmptyText.text = "لا توجد نتائج للبحث: \"$query\""
        } else if (allAudioFiles.isEmpty()) {
            // لا تفعل شيء، تم التعامل معه في scanLibrary
        } else {
            libraryEmptyText.visibility = View.GONE
        }
    }

    private fun playAudioFile(file: AudioFile) {
        try {
            prefs.edit()
                .putString(KEY_FILE, file.uri.toString())
                .putString(KEY_FILE_NAME, file.title)
                .apply()
            service?.setSource(file.uri, "${file.title} - ${file.artist}")
            service?.playWithFocus()
            updatePlayerUi()
            trackName.text = "${file.title} - ${file.artist}"
            Toast.makeText(this, "يعزف الآن: ${file.title}", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "تعذر تشغيل الملف: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ------------------------------------------------------------- المسارات

    private fun isBluetooth(route: RouteConfig): Boolean {
        val type = route.target.device?.type
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                (Build.VERSION.SDK_INT >= 31 && (
                        type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                        type == AudioDeviceInfo.TYPE_BLE_BROADCAST)) ||
                route.target.address.contains(":")
    }

    private fun refreshDevices() {
        val found = OutputScanner.scan(this)
        val next = found.map { target ->
            val old = routes.firstOrNull { it.target.key == target.key }
            RouteConfig(
                target = target,
                gain = old?.gain ?: prefs.getFloat("gain:${target.key}", 0.90f),
                trimMs = old?.trimMs ?: prefs.getInt("trim:${target.key}", 0),
                enabled = old?.enabled ?: run {
                    val isBt = target.address.contains(":") || target.device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    if (isBt) prefs.getBoolean("on:${target.key}", true)
                    else {
                        val hasBt = found.any { it.address.contains(":") || it.device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
                        if (hasBt) prefs.getBoolean("on:${target.key}", false)
                        else prefs.getBoolean("on:${target.key}", true)
                    }
                }
            )
        }
        routes.clear()
        routes.addAll(next)
        deviceAdapter.notifyDataSetChanged()
        emptyText.visibility = if (routes.isEmpty()) View.VISIBLE else View.GONE
        pushRoutes()
        updateStatus()
    }

    private fun pushRoutes() { service?.setRoutes(routes) }

    private fun restoreSource() {
        if (service?.engine?.hasSource() == true) { updatePlayerUi(); return }
        val saved = prefs.getString(KEY_FILE, null)
        if (saved != null) {
            try {
                service?.setSource(Uri.parse(saved), prefs.getString(KEY_FILE_NAME, "ملف صوتي") ?: "ملف صوتي")
                updatePlayerUi()
                return
            } catch (_: Exception) {}
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
        trackName.text = state?.sourceName?.ifBlank { getString(R.string.no_file) } ?: getString(R.string.no_file)
    }

    private fun updateStatus() {
        val enabled = routes.count { it.enabled }
        val bt = routes.count { it.enabled && isBluetooth(it) }
        val phoneOn = routes.any { it.enabled && !isBluetooth(it) }
        statusText.text = when {
            routes.isEmpty() -> "لا توجد مخارج صوت ظاهرة. اربط سماعة بلوتوث من إعدادات الهاتف، ثم اضغط «تحديث السماعات»."
            enabled == 0 -> "فعّل مخرجًا واحدًا على الأقل بالأسفل لتسمع الصوت."
            bt >= 2 && phoneOn -> "جاهز — $bt سماعات بلوتوث مفعلة مع مكبر الهاتف. قد تسمع صدى بسيط."
            bt >= 2 -> "ممتاز — $bt سماعات بلوتوث ستعمل معًا بدون تقطيع. اختر أغنية من مكتبة MP3 أعلاه."
            bt == 1 && enabled == 1 -> "جاهز — سماعة بلوتوث واحدة مفعلة. الصوت لن يذهب للهاتف."
            bt == 1 -> "جاهز — $enabled مخرج مفعّل منها $bt بلوتوث. اختر ملف MP3 من المكتبة."
            else -> "جاهز — $enabled مخرج مفعّل. اربط سماعة بلوتوث ليظهر اسمها هنا."
        }
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

    // -------------------------------------------------------------- القوائم

    private inner class DeviceAdapter : RecyclerView.Adapter<DeviceAdapter.Holder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_device, parent, false)
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

    private inner class AudioAdapter : RecyclerView.Adapter<AudioAdapter.Holder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_audio, parent, false)
            return Holder(view)
        }
        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(filteredAudioFiles[position])
        override fun getItemCount(): Int = filteredAudioFiles.size

        inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
            private val title: TextView = view.findViewById(R.id.audioTitle)
            private val artist: TextView = view.findViewById(R.id.audioArtist)
            private val meta: TextView = view.findViewById(R.id.audioMeta)
            private val badge: TextView = view.findViewById(R.id.audioBadge)

            fun bind(file: AudioFile) {
                title.text = file.title
                artist.text = if (file.artist.isBlank() || file.artist == "<unknown>") file.displayName else "${file.artist} • ${file.album}".trim()
                val duration = MediaLibraryScanner.formatDuration(file.durationMs)
                val size = MediaLibraryScanner.formatSize(file.sizeBytes)
                val ext = file.displayName.substringAfterLast('.', "").uppercase().ifBlank { "AUDIO" }
                meta.text = "$ext · $duration · $size"
                badge.text = ext

                // تمييز الملف الحالي
                val currentUri = prefs.getString(KEY_FILE, null)
                val isCurrent = currentUri == file.uri.toString()
                itemView.alpha = if (isCurrent) 1f else 0.95f
                title.setTextColor(
                    if (isCurrent) ContextCompat.getColor(itemView.context, R.color.gold)
                    else ContextCompat.getColor(itemView.context, R.color.cream)
                )

                itemView.setOnClickListener { playAudioFile(file) }

                itemView.setOnLongClickListener {
                    Toast.makeText(
                        itemView.context,
                        "${file.title}\n${file.artist}\n${file.displayName}\n${file.path}",
                        Toast.LENGTH_LONG
                    ).show()
                    true
                }
            }
        }
    }

    companion object {
        private const val KEY_FILE = "source_uri"
        private const val KEY_FILE_NAME = "source_name"
    }
}
