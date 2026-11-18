package com.genxcrm.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

// Shown full-screen (even over the lock screen) when GenxcrmMessagingService
// receives a CALL_ALERT push. Tapping Call opens ACTION_DIAL — the native
// dialer, pre-filled, with the rep still tapping the dialer's own Call button
// to actually place the call. This activity never requests CALL_PHONE and
// never fires ACTION_CALL; see the design doc referenced in
// GenxcrmMessagingService for why that boundary matters for Play Store policy.
class CallAlertActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_LEAD_NAME = "leadName"
        const val EXTRA_PHONE = "phone"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }

        setContentView(R.layout.activity_call_alert)

        val leadName = intent.getStringExtra(EXTRA_LEAD_NAME) ?: "Lead"
        val phone = intent.getStringExtra(EXTRA_PHONE) ?: ""

        findViewById<TextView>(R.id.leadNameText).text = leadName
        findViewById<TextView>(R.id.phoneText).text = phone

        findViewById<Button>(R.id.dismissButton).setOnClickListener { finish() }

        findViewById<Button>(R.id.callButton).setOnClickListener {
            val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))
            startActivity(dialIntent)
            finish()
        }
    }
}
