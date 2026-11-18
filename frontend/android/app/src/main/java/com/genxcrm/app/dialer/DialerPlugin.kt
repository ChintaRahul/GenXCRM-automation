package com.genxcrm.app.dialer

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telecom.TelecomManager
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File

@CapacitorPlugin(
    name = "GenXDialer",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE], alias = "phone"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
    ],
)
class DialerPlugin : Plugin() {
    private val supported get() = Build.VERSION.SDK_INT >= 29

    override fun load() {
        CallManager.init(context)
        CallManager.onEnded = { notifyListeners("callEnded", JSObject()) }
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasDialerRole(): Boolean =
        supported && context.getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_DIALER)

    // Bluetooth permission only exists from API 31; below that it is implicitly available.
    private fun permissionState() = JSObject()
        .put("microphone", granted(Manifest.permission.RECORD_AUDIO))
        .put("phone", granted(Manifest.permission.CALL_PHONE) && granted(Manifest.permission.READ_PHONE_STATE))
        .put("bluetooth", Build.VERSION.SDK_INT < 31 || granted(Manifest.permission.BLUETOOTH_CONNECT))

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(permissionState().put("supported", supported).put("dialerRole", hasDialerRole()))
    }

    @PluginMethod
    fun requestDefaultDialer(call: PluginCall) {
        if (!supported) return call.reject("Requires Android 10 or newer")
        if (hasDialerRole()) return call.resolve(JSObject().put("granted", true))
        val intent = context.getSystemService(RoleManager::class.java).createRequestRoleIntent(RoleManager.ROLE_DIALER)
        startActivityForResult(call, intent, "dialerRoleResult")
    }

    @ActivityCallback
    private fun dialerRoleResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        call?.resolve(JSObject().put("granted", hasDialerRole()))
    }

    @PluginMethod
    fun requestSetupPermissions(call: PluginCall) {
        val aliases = buildList {
            add("microphone"); add("phone")
            if (Build.VERSION.SDK_INT >= 31) add("bluetooth")
        }.toTypedArray()
        requestPermissionForAliases(aliases, call, "permissionsResult")
    }

    @PermissionCallback
    private fun permissionsResult(call: PluginCall) {
        call.resolve(permissionState())
    }

    @PluginMethod
    fun placeCall(call: PluginCall) {
        val number = call.getString("number") ?: return call.reject("number is required")
        if (!granted(Manifest.permission.CALL_PHONE)) return call.reject("Phone permission not granted")
        if (!hasDialerRole()) return call.reject("GenXCRM is not the default phone app")
        call.getString("leadId")?.let { CallManager.expectLead(it) }
        context.getSystemService(Context.TELECOM_SERVICE).let { it as TelecomManager }
            .placeCall(Uri.fromParts("tel", number, null), null)
        call.resolve()
    }

    @PluginMethod
    fun syncLeads(call: PluginCall) {
        val leads: JSArray = call.getArray("leads") ?: return call.reject("leads is required")
        val entries = List(leads.length()) { index ->
            val item = leads.getJSONObject(index)
            item.getString("phone") to LeadRef(item.getString("leadId"), item.optString("name"))
        }
        CallManager.syncLeads(entries)
        call.resolve()
    }

    @PluginMethod
    fun getPendingCalls(call: PluginCall) {
        val calls = JSArray()
        CallManager.pending.all().forEach { calls.put(it) }
        call.resolve(JSObject().put("calls", calls))
    }

    @PluginMethod
    fun ackCall(call: PluginCall) {
        CallManager.pending.remove(call.getString("id") ?: return call.reject("id is required"))
        call.resolve()
    }

    @PluginMethod
    fun uploadRecording(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required")
        val url = call.getString("url") ?: return call.reject("url is required")
        val mimeType = call.getString("mimeType") ?: "audio/mp4"
        Thread {
            try {
                call.resolve(JSObject().put("size", RecordingUploader.put(path, url, mimeType)))
            } catch (e: Exception) {
                call.reject(e.message ?: "Upload failed")
            }
        }.start()
    }

    @PluginMethod
    fun deleteRecording(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required")
        // Only ever delete inside our own recordings dir.
        val file = File(path)
        if (file.parentFile == File(context.filesDir, "recordings")) file.delete()
        call.resolve()
    }
}
