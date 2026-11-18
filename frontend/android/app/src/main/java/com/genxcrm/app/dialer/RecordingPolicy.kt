package com.genxcrm.app.dialer

enum class AudioRoute { EARPIECE, SPEAKER, BLUETOOTH, WIRED }

data class RecordingDecision(val record: Boolean, val bothSides: Boolean)

object RecordingPolicy {
    // Only calls with leads are ever recorded. Only the loudspeaker lets the phone mic hear the
    // customer too; every other route captures the rep's side only, and the UI says so.
    fun decide(matchedLead: Boolean, hasMicPermission: Boolean, route: AudioRoute): RecordingDecision {
        val record = matchedLead && hasMicPermission
        return RecordingDecision(record, bothSides = record && route == AudioRoute.SPEAKER)
    }
}
