package com.genxcrm.app.dialer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.VideoProfile
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.UUID

// Single source of truth for the one active call. Everything else (in-call screen, plugin,
// recording service) talks to this object; nothing else reads Telecom state directly.
object CallManager {
    data class State(
        val callId: String,
        val number: String,
        val leadId: String?,
        val leadName: String?,
        val direction: String,
        val status: String,
        val muted: Boolean,
        val route: AudioRoute,
        val recording: Boolean,
        val bothSides: Boolean,
    )

    private lateinit var appContext: Context
    private lateinit var matcher: LeadMatcher
    lateinit var pending: PendingCallStore
        private set

    private var service: GenXInCallService? = null
    private var call: Call? = null
    private var callId = ""
    private var number = ""
    private var lead: LeadRef? = null
    private var expectedLeadId: String? = null
    private var expectedLeadIdSetAt: Long = 0L
    private var direction = "outbound"
    private var startedAt = 0L
    private var ended = false
    private var recordingActive = false
    private var route = AudioRoute.EARPIECE
    private var muted = false

    // Snapshot of the call that is finishing, captured before shared current-call fields can be
    // reused by a subsequent onCallAdded. Consumed by onRecordingFinished (or immediately by
    // finishCall when there's no active recording) so a fast follow-up call never steals it.
    private data class PendingFinish(
        val callId: String,
        val lead: LeadRef,
        val number: String,
        val direction: String,
        val startedAt: Long,
    )
    private var pendingFinish: PendingFinish? = null

    private val expectedLeadTtlMs = 15_000L

    var listener: ((State?) -> Unit)? = null
    var onEnded: (() -> Unit)? = null

    @Synchronized fun init(context: Context) {
        if (::appContext.isInitialized) return
        appContext = context.applicationContext
        matcher = LeadMatcher(SharedPrefsLeadStore(appContext))
        pending = PendingCallStore(appContext)
    }

    fun syncLeads(entries: List<Pair<String, LeadRef>>) = matcher.replaceAll(entries)

    fun expectLead(leadId: String) {
        expectedLeadId = leadId
        expectedLeadIdSetAt = System.currentTimeMillis()
    }

    // ── Telecom callbacks ───────────────────────────────────────────────────────────────

    private val callback = object : Call.Callback() {
        override fun onStateChanged(c: Call, state: Int) {
            if (state == Call.STATE_ACTIVE && startedAt == 0L) {
                startedAt = System.currentTimeMillis()
                startRecordingIfNeeded()
            }
            if (state == Call.STATE_DISCONNECTED) finishCall()
            publish()
        }
    }

    fun onCallAdded(from: GenXInCallService, added: Call) {
        init(from)
        service = from
        call = added
        callId = UUID.randomUUID().toString()
        number = added.details.handle?.schemeSpecificPart.orEmpty()
        val freshExpectedLeadId = expectedLeadId?.takeIf {
            System.currentTimeMillis() - expectedLeadIdSetAt <= expectedLeadTtlMs
        }
        lead = matcher.match(number) ?: freshExpectedLeadId?.let { LeadRef(it, number) }
        expectedLeadId = null
        direction = if (added.state == Call.STATE_RINGING) "inbound" else "outbound"
        startedAt = 0L
        ended = false
        recordingActive = false
        added.registerCallback(callback)
        CallNotifier.show(appContext, snapshot())
        publish()
    }

    fun onCallRemoved() {
        // Telecom removed the call without ever reporting DISCONNECTED (rare) — finish anyway.
        if (call != null && !ended) finishCall()
    }

    @Suppress("DEPRECATION")
    fun onAudioStateChanged(state: CallAudioState) {
        muted = state.isMuted
        route = when (state.route) {
            CallAudioState.ROUTE_SPEAKER -> AudioRoute.SPEAKER
            CallAudioState.ROUTE_BLUETOOTH -> AudioRoute.BLUETOOTH
            CallAudioState.ROUTE_WIRED_HEADSET -> AudioRoute.WIRED
            else -> AudioRoute.EARPIECE
        }
        publish()
    }

    // ── Recording callbacks ─────────────────────────────────────────────────────────────

    fun onRecordingStarted() { recordingActive = true; publish() }
    fun onRecordingFailed() { recordingActive = false; publish() }
    fun onRecordingFinished() {
        recordingActive = false
        val finishing = pendingFinish
        if (finishing != null) {
            pendingFinish = null
            writePending(finishing.callId, finishing.lead, finishing.number, finishing.direction, finishing.startedAt)
            resetIfStillCurrent(finishing.callId)
        }
        publish()
    }

    private fun startRecordingIfNeeded() {
        val hasMic = ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (RecordingPolicy.decide(lead != null, hasMic, route).record) {
            RecordingService.start(appContext, callId)
        }
    }

    // ── User actions (from InCallActivity) ──────────────────────────────────────────────

    fun answer() { call?.answer(VideoProfile.STATE_AUDIO_ONLY) }
    fun reject() { call?.reject(false, null) }
    fun hangup() { call?.disconnect() }
    fun toggleHold() {
        val current = call ?: return
        if (current.state == Call.STATE_HOLDING) current.unhold() else current.hold()
    }
    fun dtmf(digit: Char) { call?.playDtmfTone(digit); call?.stopDtmfTone() }

    @Suppress("DEPRECATION")
    fun setMuted(value: Boolean) { service?.setMuted(value) }

    @Suppress("DEPRECATION")
    fun setRoute(target: AudioRoute) {
        service?.setAudioRoute(
            when (target) {
                AudioRoute.SPEAKER -> CallAudioState.ROUTE_SPEAKER
                AudioRoute.BLUETOOTH -> CallAudioState.ROUTE_BLUETOOTH
                AudioRoute.WIRED -> CallAudioState.ROUTE_WIRED_HEADSET
                AudioRoute.EARPIECE -> CallAudioState.ROUTE_EARPIECE
            },
        )
    }

    // ── Internals ───────────────────────────────────────────────────────────────────────

    private fun finishCall() {
        if (ended) return
        ended = true
        call?.unregisterCallback(callback)
        CallNotifier.cancel(appContext)
        if (recordingActive) {
            // Snapshot this call's data now, before a subsequent onCallAdded can overwrite the
            // shared current-call fields — onRecordingFinished (async) reads from this snapshot,
            // never from the live fields, so a fast next call can't steal or drop this entry.
            val current = lead
            if (current != null) {
                pendingFinish = PendingFinish(callId, current, number, direction, startedAt)
            }
            RecordingService.stop(appContext)
        } else {
            val current = lead
            if (current != null) writePending(callId, current, number, direction, startedAt)
            reset()
        }
        publish()
    }

    // Only lead calls are ever stored — personal calls leave no trace here.
    private fun writePending(finishedCallId: String, finishedLead: LeadRef, finishedNumber: String, finishedDirection: String, finishedStartedAt: Long) {
        val file = RecordingService.fileFor(appContext, finishedCallId)
        val started = if (finishedStartedAt > 0) finishedStartedAt else System.currentTimeMillis()
        pending.add(
            JSONObject()
                .put("id", finishedCallId)
                .put("number", finishedNumber)
                .put("leadId", finishedLead.leadId)
                .put("direction", finishedDirection)
                .put("startedAt", started)
                .put("durationSec", if (finishedStartedAt > 0) ((System.currentTimeMillis() - finishedStartedAt) / 1000).toInt() else 0)
                .put("connected", finishedStartedAt > 0)
                .put("recordingPath", if (file.exists() && file.length() > 0) file.absolutePath else JSONObject.NULL),
        )
        onEnded?.invoke()
    }

    // Only clears the shared current-call fields if they still belong to the call that just
    // finished — if a new call has already replaced them (onCallAdded ran first), leave them
    // alone so we don't clobber the new call's live state.
    private fun resetIfStillCurrent(finishedCallId: String) {
        if (callId == finishedCallId) reset()
    }

    private fun reset() {
        call = null
        lead = null
        recordingActive = false
        startedAt = 0L
        publish()
    }

    private fun snapshot(): State? {
        val current = call ?: return null
        if (ended) return null
        val decision = RecordingPolicy.decide(lead != null, true, route)
        val status = when (current.state) {
            Call.STATE_RINGING -> "ringing"
            Call.STATE_HOLDING -> "holding"
            Call.STATE_ACTIVE -> "active"
            else -> "dialing"
        }
        return State(callId, number, lead?.leadId, lead?.name, direction, status, muted, route, recordingActive, decision.bothSides)
    }

    private fun publish() { listener?.invoke(snapshot()) }
}
