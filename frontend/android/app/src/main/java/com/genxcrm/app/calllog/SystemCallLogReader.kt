package com.genxcrm.app.calllog

import android.content.Context
import android.provider.CallLog

data class SystemCallLogRow(
    val date: Long,
    val number: String,
    val durationSec: Int,
    val type: Int,
)

// Thin wrapper around the system CallLog content provider. Requires READ_CALL_LOG — callers
// must check that permission before calling.
object SystemCallLogReader {
    fun readSince(context: Context, sinceMs: Long): List<SystemCallLogRow> {
        val projection = arrayOf(CallLog.Calls.DATE, CallLog.Calls.NUMBER, CallLog.Calls.DURATION, CallLog.Calls.TYPE)
        val rows = mutableListOf<SystemCallLogRow>()
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            "${CallLog.Calls.DATE} > ?",
            arrayOf(sinceMs.toString()),
            "${CallLog.Calls.DATE} ASC",
        )?.use { cursor ->
            val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
            val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
            val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
            val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
            while (cursor.moveToNext()) {
                rows.add(
                    SystemCallLogRow(
                        date = cursor.getLong(dateIdx),
                        number = cursor.getString(numberIdx).orEmpty(),
                        durationSec = cursor.getInt(durationIdx),
                        type = cursor.getInt(typeIdx),
                    ),
                )
            }
        }
        return rows
    }
}
