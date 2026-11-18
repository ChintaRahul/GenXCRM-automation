package com.genxcrm.app.dialer

import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService

class GenXInCallService : InCallService() {
    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        CallManager.onCallAdded(this, call)
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        CallManager.onCallRemoved()
    }

    @Deprecated("Superseded by onCallEndpointChanged on API 34, still delivered on all versions")
    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        super.onCallAudioStateChanged(audioState)
        CallManager.onAudioStateChanged(audioState)
    }
}
