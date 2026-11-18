package com.genxcrm.app.calllog

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.genxcrm.app.dialer.LeadMatcher
import com.genxcrm.app.dialer.LeadRef
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// Reads call duration + connected/missed status for calls placed or received through the OS
// phone app (no default-dialer role, no recording — see CallLogSyncWorker). JS drains queued
// matches with getPendingCalls/ackCall, the same pattern the old dialer plugin used for
// recordings, and logs each one through the existing POST /communications/call.
@CapacitorPlugin(
    name = "GenXCallLog",
    permissions = [Permission(strings = [Manifest.permission.READ_CALL_LOG], alias = "callLog")],
)
class CallLogPlugin : Plugin() {
    private lateinit var matcher: LeadMatcher
    private lateinit var pending: PendingSystemCallStore

    override fun load() {
        matcher = LeadMatcher(SharedPrefsCallLogLeadStore(context))
        pending = PendingSystemCallStore(context)
        if (granted()) CallLogSyncWorker.schedule(context)
    }

    private fun granted() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().put("granted", granted()))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (granted()) return call.resolve(JSObject().put("granted", true))
        requestPermissionForAlias("callLog", call, "permissionResult")
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        if (granted()) CallLogSyncWorker.schedule(context)
        call.resolve(JSObject().put("granted", granted()))
    }

    // Pushed on login and whenever the rep's lead list changes (see useCallLogSync.ts). Only
    // numbers in this index are ever matched, so a personal call never gets logged.
    @PluginMethod
    fun syncLeads(call: PluginCall) {
        val leads: JSArray = call.getArray("leads") ?: return call.reject("leads is required")
        val entries = List(leads.length()) { index ->
            val item = leads.getJSONObject(index)
            item.getString("phone") to LeadRef(item.getString("leadId"), item.optString("name"))
        }
        matcher.replaceAll(entries)
        call.resolve()
    }

    // Immediate scan trigger — called from JS the moment the rep returns to the app (e.g. right
    // after a call), so a call doesn't wait for the next periodic CallLogSyncWorker run to show
    // up. ContentResolver query runs off the main thread.
    @PluginMethod
    fun syncNow(call: PluginCall) {
        if (!granted()) return call.resolve()
        Thread {
            CallLogScanner.scan(context)
            call.resolve()
        }.start()
    }

    @PluginMethod
    fun getPendingCalls(call: PluginCall) {
        val calls = JSArray()
        pending.all().forEach { calls.put(it) }
        call.resolve(JSObject().put("calls", calls))
    }

    @PluginMethod
    fun ackCall(call: PluginCall) {
        pending.remove(call.getString("id") ?: return call.reject("id is required"))
        call.resolve()
    }
}
