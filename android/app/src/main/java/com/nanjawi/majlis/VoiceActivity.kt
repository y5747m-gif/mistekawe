package com.nanjawi.majlis

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.Locale

/** Only our HTTPS voice page can ask for microphone input or speech output. */
class VoiceActivity : AppCompatActivity() {
    companion object {
        private const val ORIGIN = "https://mistekawe.vercel.app"
        private const val PAGE = "$ORIGIN/voice.html"
        private const val BRIDGE = "MajlisVoice"
    }

    private data class Listening(val id: Int, val reply: JavaScriptReplyProxy)
    private var active: Listening? = null
    private var recognizer: SpeechRecognizer? = null
    private var permissionPending = false
    private var inForeground = false
    private var tts: TextToSpeech? = null
    private var canSpeakArabic = false
    private var queuedSpeech: (() -> Unit)? = null
    private var ttsInitialized = false
    private lateinit var web: WebView

    private val microphone = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionPending = false
        val request = active ?: return@registerForActivityResult
        if (granted && inForeground) startListening(request)
        else complete(request, error = if (granted) "aborted" else "not-allowed")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        val container = FrameLayout(this).apply { addView(web, FrameLayout.LayoutParams(-1, -1)) }
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val p = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(p.left, p.top, p.right, p.bottom)
            insets
        }
        setContentView(container)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return true
                return handleNavigation(request.url, request.hasGesture())
            }

            // API 23 uses this overload; don't open external intents without a known gesture.
            @Deprecated("Used on Android 6")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                handleNavigation(Uri.parse(url), false)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, BRIDGE, setOf(ORIGIN)) { view, message, source, main, reply ->
                if (main && source.scheme == "https" && source.host == "mistekawe.vercel.app" &&
                    source.port in listOf(-1, 443) && isVoicePage(Uri.parse(view.url.orEmpty()))) {
                    runCatching { JSONObject(message.data.orEmpty()) }.getOrNull()?.let { handleMessage(it, reply) }
                }
            }
        }
        web.loadUrl(PAGE)
    }

    private fun isVoicePage(uri: Uri): Boolean = uri.scheme == "https" && uri.authority == "mistekawe.vercel.app" && uri.path == "/voice.html"

    private fun handleNavigation(uri: Uri, fromTap: Boolean): Boolean {
        if (isVoicePage(uri)) return false
        if (fromTap && uri.scheme == "https") runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        return true
    }

    private fun post(reply: JavaScriptReplyProxy, data: JSONObject) {
        runCatching { reply.postMessage(data.toString()) }
    }

    private fun handleMessage(message: JSONObject, reply: JavaScriptReplyProxy) {
        val id = message.optInt("id", -1)
        when (message.optString("action")) {
            "listen" -> {
                if (!inForeground || id <= 0) return
                if (permissionPending || active != null) {
                    post(reply, JSONObject().put("action", "result").put("id", id).put("error", "busy"))
                    return
                }
                val request = Listening(id, reply)
                active = request
                if (!SpeechRecognizer.isRecognitionAvailable(this)) complete(request, error = "unsupported")
                else if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    startListening(request)
                } else {
                    permissionPending = true
                    microphone.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
            "cancel" -> active?.takeIf { it.id == id }?.let { complete(it, error = "aborted") }
            "speak" -> if (inForeground && active == null) speak(message, reply)
            "stopSpeech" -> stopSpeech()
        }
    }

    private fun startListening(request: Listening) {
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) = Unit
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() = Unit
                    override fun onPartialResults(partialResults: Bundle?) = Unit
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                    override fun onError(error: Int) = complete(request, error = when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "unsupported"
                        else -> "no-speech"
                    })
                    override fun onResults(results: Bundle?) = complete(request,
                        text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
                })
            }
            recognizer?.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-EG")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            })
        } catch (_: SecurityException) { complete(request, error = "not-allowed") }
        catch (_: RuntimeException) { complete(request, error = "unsupported") }
    }

    private fun complete(request: Listening, text: String = "", error: String = "") {
        if (active !== request) return
        active = null
        val old = recognizer
        recognizer = null
        old?.cancel()
        old?.destroy()
        post(request.reply, JSONObject().put("action", "result").put("id", request.id)
            .put("text", text.take(2000)).put("error", error))
    }

    private fun speak(message: JSONObject, reply: JavaScriptReplyProxy) {
        val text = message.optString("text").take(2500).trim()
        if (text.isBlank()) return
        val volume = message.optDouble("volume", 0.4).coerceIn(0.0, 1.0).toFloat()
        val play: () -> Unit = {
            val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume) }
            if (!canSpeakArabic || tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "raheeq") != TextToSpeech.SUCCESS) {
                post(reply, JSONObject().put("action", "speech-error"))
            }
        }
        if (ttsInitialized) play()
        else {
            queuedSpeech = play
            if (tts == null) tts = TextToSpeech(applicationContext) { status ->
                Handler(Looper.getMainLooper()).post {
                    if (isDestroyed) return@post
                    val engine = tts
                    canSpeakArabic = status == TextToSpeech.SUCCESS && engine != null &&
                        (engine.setLanguage(Locale.forLanguageTag("ar-EG")) >= TextToSpeech.LANG_AVAILABLE ||
                            engine.setLanguage(Locale.forLanguageTag("ar")) >= TextToSpeech.LANG_AVAILABLE)
                    ttsInitialized = true
                    if (inForeground) queuedSpeech?.invoke()
                    queuedSpeech = null
                }
            }
        }
    }

    private fun stopSpeech() {
        queuedSpeech = null
        tts?.stop()
    }

    override fun onStart() {
        super.onStart()
        inForeground = true
        web.onResume()
    }

    override fun onStop() {
        inForeground = false
        active?.let { complete(it, error = "aborted") }
        stopSpeech()
        web.onPause()
        super.onStop()
    }

    override fun onDestroy() {
        tts?.shutdown()
        (web.parent as? FrameLayout)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
