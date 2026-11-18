package com.genxcrm.app.dialer

object PhoneNumbers {
    // Leads store bare 10-digit Indian numbers (backend phone.util.ts), while the dialer sees
    // +91…, 0…, or spaced/dashed forms. Comparing the last 10 digits matches all of them.
    fun normalize(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        return if (digits.length > 10) digits.takeLast(10) else digits
    }
}
