package com.genxcrm.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Receives the data-only "CALL_ALERT" FCM message sent by
// backend/src/integrations/firebase/firebase.service.ts and turns it into a
// full-screen, lock-screen-visible alert. Deliberately never places the call
// itself (no CALL_PHONE / ACTION_CALL) — CallAlertActivity's Call button only
// ever opens ACTION_DIAL, so the OS dialer's own button is what actually
// places the call. See docs/superpowers/specs/2026-09-13-desktop-call-alert-design.md.
class GenxcrmMessagingService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "call_alerts"
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "CALL_ALERT") return

        val leadName = data["leadName"] ?: "Lead"
        val phone = data["phone"] ?: return

        ensureChannel()

        val fullScreenIntent = Intent(this, CallAlertActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(CallAlertActivity.EXTRA_LEAD_NAME, leadName)
            putExtra(CallAlertActivity.EXTRA_PHONE, phone)
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Call $leadName")
            .setContentText(phone)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setAutoCancel(true)
            .build()

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(phone.hashCode(), notification)
    }

    override fun onNewToken(token: String) {
        // The JS side (useCallAlertRegistration.ts) re-registers on every app-open
        // via PushNotifications.register(), which is Capacitor's own token-refresh
        // path — nothing additional needed here.
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID, "Call alerts", NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Full-screen alerts when a call is triggered from the desktop app"
        }
        manager.createNotificationChannel(channel)
    }
}
