package com.genxcrm.app.dialer

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.genxcrm.app.R

// Speaks the consent line, then calls onDone exactly once (also on TTS failure or after a
// 6s ceiling) so a broken TTS engine can never block or delay a recording indefinitely.
class ConsentAnnouncer(private val context: Context) {
    private var tts: TextToSpeech? = null
    private var finished = false
    private val main = Handler(Looper.getMainLooper())

    fun play(onDone: () -> Unit) {
        val finish = {
            if (!finished) {
                finished = true
                tts?.shutdown()
                onDone()
            }
        }
        main.postDelayed({ finish() }, 6_000)
        tts = TextToSpeech(context) { status ->
            val engine = tts
            if (status != TextToSpeech.SUCCESS || engine == null) {
                main.post { finish() }
                return@TextToSpeech
            }
            engine.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { main.post { finish() } }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { main.post { finish() } }
            })
            engine.speak(context.getString(R.string.consent_announcement), TextToSpeech.QUEUE_FLUSH, null, "consent")
        }
    }

    fun cancel() {
        finished = true
        tts?.shutdown()
    }
}
