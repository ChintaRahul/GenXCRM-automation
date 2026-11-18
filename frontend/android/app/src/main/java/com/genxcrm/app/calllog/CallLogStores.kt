package com.genxcrm.app.calllog

import android.content.Context
import com.genxcrm.app.dialer.LeadStore
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS = "genx_calllog"

// Own prefs namespace, kept fully separate from the disabled dialer feature's "genx_dialer"
// store so this can outlive it (or be removed independently later).
class SharedPrefsCallLogLeadStore(context: Context) : LeadStore {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    override fun read(): String? = prefs.getString("leads", null)
    override fun write(text: String) {
        prefs.edit().putString("leads", text).apply()
    }
}

// Lead-matched system calls the worker found, waiting for JS to drain and log them via the
// existing /communications/call endpoint. Native-owned so a call detected while the WebView is
// paused/killed is still delivered the next time the app opens.
class PendingSystemCallStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized fun add(call: JSONObject) {
        write(all() + call)
    }

    @Synchronized fun all(): List<JSONObject> {
        val array = JSONArray(prefs.getString("pending", "[]"))
        return List(array.length()) { array.getJSONObject(it) }
    }

    @Synchronized fun remove(id: String) {
        write(all().filterNot { it.optString("id") == id })
    }

    private fun write(calls: List<JSONObject>) {
        prefs.edit().putString("pending", JSONArray(calls).toString()).apply()
    }
}

// High-water mark so the worker only ever scans CallLog rows it hasn't already seen.
class CallLogCursor(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var lastSyncedAtMs: Long
        get() = prefs.getLong("lastSyncedAtMs", 0L)
        set(value) {
            prefs.edit().putLong("lastSyncedAtMs", value).apply()
        }
}
