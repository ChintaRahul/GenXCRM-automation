package com.genxcrm.app.dialer

import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.GridLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.genxcrm.app.R

class InCallActivity : AppCompatActivity() {
    private lateinit var muteButton: Button
    private var latest: CallManager.State? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        setContentView(R.layout.activity_in_call)
        muteButton = findViewById(R.id.muteButton)

        muteButton.setOnClickListener { latest?.let { CallManager.setMuted(!it.muted) } }
        findViewById<Button>(R.id.speakerButton).setOnClickListener {
            val speakerOn = latest?.route == AudioRoute.SPEAKER
            CallManager.setRoute(if (speakerOn) AudioRoute.EARPIECE else AudioRoute.SPEAKER)
        }
        findViewById<Button>(R.id.bluetoothButton).setOnClickListener { CallManager.setRoute(AudioRoute.BLUETOOTH) }
        findViewById<Button>(R.id.holdButton).setOnClickListener { CallManager.toggleHold() }
        findViewById<Button>(R.id.answerButton).setOnClickListener { CallManager.answer() }
        findViewById<Button>(R.id.endButton).setOnClickListener {
            if (latest?.status == "ringing") CallManager.reject() else CallManager.hangup()
        }

        val dtmfGrid = findViewById<GridLayout>(R.id.dtmfGrid)
        "123456789*0#".forEach { digit ->
            dtmfGrid.addView(
                Button(this).apply {
                    text = digit.toString()
                    setOnClickListener { CallManager.dtmf(digit) }
                    layoutParams = GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED, 1f), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                        width = 0
                        setMargins(6, 6, 6, 6)
                    }
                },
            )
        }
        findViewById<Button>(R.id.keypadToggle).setOnClickListener {
            dtmfGrid.visibility = if (dtmfGrid.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
    }

    override fun onStart() {
        super.onStart()
        CallManager.listener = { state -> runOnUiThread { render(state) } }
    }

    override fun onStop() {
        CallManager.listener = null
        super.onStop()
    }

    private fun render(state: CallManager.State?) {
        latest = state
        if (state == null) {
            finish()
            return
        }
        findViewById<TextView>(R.id.nameText).apply {
            text = state.leadName ?: state.number
            contentDescription = text
        }
        findViewById<TextView>(R.id.numberText).text = state.number
        findViewById<TextView>(R.id.statusText).text = state.status.replaceFirstChar { it.uppercase() }
        muteButton.text = getString(R.string.incall_mute) + if (state.muted) " ✓" else ""
        findViewById<Button>(R.id.answerButton).visibility = if (state.status == "ringing") View.VISIBLE else View.GONE
        findViewById<Button>(R.id.endButton).text =
            getString(if (state.status == "ringing") R.string.incall_decline else R.string.incall_end)

        val recordingText = findViewById<TextView>(R.id.recordingText)
        val isLeadCall = state.leadId != null
        recordingText.visibility = if (isLeadCall && state.status != "ringing") View.VISIBLE else View.GONE
        recordingText.text = getString(
            when {
                !state.recording -> R.string.incall_not_recording
                state.bothSides -> R.string.incall_recording_both
                else -> R.string.incall_recording_rep_only
            },
        )
    }
}
