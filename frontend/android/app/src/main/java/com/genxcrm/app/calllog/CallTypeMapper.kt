package com.genxcrm.app.calllog

// Pure mapping from android.provider.CallLog.Calls.TYPE + duration to what the CRM needs.
// Local literals instead of the framework constants so this stays a plain JVM unit test (no
// Android stub jar / Robolectric needed) — see CallTypeMapperTest. Values match
// android.provider.CallLog.Calls: INCOMING_TYPE=1, OUTGOING_TYPE=2, MISSED_TYPE=3,
// VOICEMAIL_TYPE=4, REJECTED_TYPE=5, BLOCKED_TYPE=6, ANSWERED_EXTERNALLY_TYPE=7.
object CallTypeMapper {
    private const val OUTGOING_TYPE = 2

    // "outbound"/"inbound" — matches backend logCall()'s direction param (phone.util.ts).
    fun direction(callLogType: Int): String = if (callLogType == OUTGOING_TYPE) "outbound" else "inbound"

    // A missed/rejected/blocked call always has durationSec == 0 in the system CallLog, so
    // duration alone is a reliable "did the call actually happen" signal — matches backend's
    // CallOutcome enum (CONNECTED / NOT_CONNECTED).
    fun outcome(durationSec: Int): String = if (durationSec > 0) "CONNECTED" else "NOT_CONNECTED"
}
