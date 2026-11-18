package com.genxcrm.app.dialer

import org.junit.Assert.assertEquals
import org.junit.Test

class RecordingPolicyTest {
    @Test fun `never records a number that is not a lead`() {
        assertEquals(RecordingDecision(false, false), RecordingPolicy.decide(false, true, AudioRoute.SPEAKER))
    }

    @Test fun `never records without microphone permission`() {
        assertEquals(RecordingDecision(false, false), RecordingPolicy.decide(true, false, AudioRoute.SPEAKER))
    }

    @Test fun `speaker records both sides`() {
        assertEquals(RecordingDecision(true, true), RecordingPolicy.decide(true, true, AudioRoute.SPEAKER))
    }

    @Test fun `earpiece, bluetooth and wired record the rep's side only`() {
        for (route in listOf(AudioRoute.EARPIECE, AudioRoute.BLUETOOTH, AudioRoute.WIRED)) {
            assertEquals(RecordingDecision(true, false), RecordingPolicy.decide(true, true, route))
        }
    }
}
