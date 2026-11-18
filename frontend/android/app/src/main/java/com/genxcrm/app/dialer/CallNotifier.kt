package com.genxcrm.app.dialer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.genxcrm.app.R

// Incoming calls must surface the in-call screen even when the app is in the background or the
// device is locked; Android only allows that through a full-screen-intent notification.
object CallNotifier {
    private const val CHANNEL_ID = "genx_calls"
    private const val NOTIFICATION_ID = 4102

    fun show(context: Context, state: CallManager.State?) {
        state ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, context.getString(R.string.call_channel_name), NotificationManager.IMPORTANCE_HIGH),
        )
        val intent = PendingIntent.getActivity(
            context, 0, Intent(context, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(
            NOTIFICATION_ID,
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_action_call)
                .setContentTitle(state.leadName ?: state.number)
                .setContentText(state.number)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setContentIntent(intent)
                .setFullScreenIntent(intent, true)
                .build(),
        )
    }

    fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }
}
