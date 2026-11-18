package com.genxcrm.app.dialer

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneNumbersTest {
    @Test fun `strips country code and formatting down to the last 10 digits`() {
        assertEquals("9876543210", PhoneNumbers.normalize("+91 98765-43210"))
        assertEquals("9876543210", PhoneNumbers.normalize("09876543210"))
        assertEquals("9876543210", PhoneNumbers.normalize("9876543210"))
    }

    @Test fun `keeps short numbers as digits only`() {
        assertEquals("112", PhoneNumbers.normalize("1-1-2"))
        assertEquals("", PhoneNumbers.normalize(""))
    }
}
