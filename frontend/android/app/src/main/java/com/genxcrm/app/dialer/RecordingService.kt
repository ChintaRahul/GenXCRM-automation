package com.genxcrm.app.dialer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.genxcrm.app.R
import java.io.File

// Audio source is the ONE knob the Task 7 device spike may change (MIC vs VOICE_COMMUNICATION).
const val RECORDING_AUDIO_SOURCE = MediaRecorder.AudioSource.MIC

class RecordingService : Service() {
    private var recorder: MediaRecorder? = null
    private var announcer: ConsentAnnouncer? = null

    companion object {
        private const val TAG = "GenXRecording"
        private const val CHANNEL_ID = "genx_recording"
        private const val NOTIFICATION_ID = 4101
        private const val EXTRA_CALL_ID = "callId"
        private const val ACTION_STOP = "stop"

        fun fileFor(context: Context, callId: String) =
            File(File(context.filesDir, "recordings").apply { mkdirs() }, "$callId.m4a")

        fun start(context: Context, callId: String) {
            val intent = Intent(context, RecordingService::class.java).putExtra(EXTRA_CALL_ID, callId)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, RecordingService::class.java).setAction(ACTION_STOP))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finishRecording()
            return START_NOT_STICKY
        }
        val callId = intent?.getStringExtra(EXTRA_CALL_ID)
        if (callId == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        promoteToForeground()
        announcer = ConsentAnnouncer(applicationContext).also { it.play { beginRecording(callId) } }
        return START_NOT_STICKY
    }

    private fun promoteToForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.recording_channel_name), NotificationManager.IMPORTANCE_LOW),
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.recording_notification_title))
            .setContentText(getString(R.string.recording_notification_text))
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    private fun beginRecording(callId: String) {
        try {
            val file = fileFor(this, callId)
            recorder = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()).apply {
                setAudioSource(RECORDING_AUDIO_SOURCE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(64_000)
                setAudioSamplingRate(44_100)
                setAudioChannels(1)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            CallManager.onRecordingStarted()
        } catch (e: Exception) {
            Log.e(TAG, "MediaRecorder failed to start", e)
            recorder?.release()
            recorder = null
            CallManager.onRecordingFailed()
            stopForegroundAndSelf()
        }
    }

    private fun finishRecording() {
        announcer?.cancel()
        try {
            recorder?.stop()
        } catch (e: RuntimeException) {
            // stop() throws if almost nothing was recorded; the file is unusable then.
            Log.w(TAG, "MediaRecorder stop failed (recording too short?)", e)
        }
        recorder?.release()
        recorder = null
        CallManager.onRecordingFinished()
        stopForegroundAndSelf()
    }

    private fun stopForegroundAndSelf() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        // App/process being torn down mid-call: flush whatever we have so a partial recording survives.
        if (recorder != null) finishRecording()
        super.onDestroy()
    }
}
