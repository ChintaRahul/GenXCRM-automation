package com.genxcrm.app.dialer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS = "genx_dialer"

class SharedPrefsLeadStore(context: Context) : LeadStore {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    override fun read(): String? = prefs.getString("leads", null)
    override fun write(text: String) { prefs.edit().putString("leads", text).apply() }
}

// Ended calls that JS has not acknowledged yet. Native-owned so a call that ends while the
// WebView is paused/killed is still delivered on the next app start.
class PendingCallStore(context: Context) {
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
