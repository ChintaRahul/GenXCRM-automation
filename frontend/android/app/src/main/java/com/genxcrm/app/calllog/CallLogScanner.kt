package com.genxcrm.app.calllog

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.genxcrm.app.dialer.LeadMatcher
import com.genxcrm.app.dialer.PhoneNumbers
import org.json.JSONObject
import java.util.UUID

// The actual CallLog read + lead-match + queue step, shared by two triggers:
// CallLogSyncWorker (periodic background scan, in case the app is never opened) and
// CallLogPlugin.syncNow (an immediate scan the moment the rep returns to the app, so a call
// doesn't wait for the next periodic run to show up). Synchronous — callers on the main thread
// must run this off it.
object CallLogScanner {
    fun scan(context: Context) {
        val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasPermission) return

        val cursor = CallLogCursor(context)
        val matcher = LeadMatcher(SharedPrefsCallLogLeadStore(context))
        val pending = PendingSystemCallStore(context)

        val rows = SystemCallLogReader.readSince(context, cursor.lastSyncedAtMs)
        var latestSeen = cursor.lastSyncedAtMs
        for (row in rows) {
            latestSeen = maxOf(latestSeen, row.date)
            val lead = matcher.match(PhoneNumbers.normalize(row.number)) ?: continue
            pending.add(
                JSONObject()
                    .put("id", UUID.randomUUID().toString())
                    .put("leadId", lead.leadId)
                    .put("number", row.number)
                    .put("startedAt", row.date)
                    .put("durationSec", row.durationSec)
                    .put("direction", CallTypeMapper.direction(row.type))
                    .put("outcome", CallTypeMapper.outcome(row.durationSec)),
            )
        }
        cursor.lastSyncedAtMs = latestSeen
    }
}
