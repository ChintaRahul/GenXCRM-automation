package com.genxcrm.app.dialer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class MemoryStore(var text: String? = null) : LeadStore {
    override fun read() = text
    override fun write(text: String) { this.text = text }
}

class LeadMatcherTest {
    private val asha = LeadRef("lead-1", "Asha")

    @Test fun `matches regardless of country code or formatting`() {
        val matcher = LeadMatcher(MemoryStore())
        matcher.replaceAll(listOf("9876543210" to asha))
        assertEquals(asha, matcher.match("+91 98765 43210"))
        assertEquals(asha, matcher.match("09876543210"))
    }

    @Test fun `returns null for an unknown or blank number`() {
        val matcher = LeadMatcher(MemoryStore())
        matcher.replaceAll(listOf("9876543210" to asha))
        assertNull(matcher.match("9000000000"))
        assertNull(matcher.match(""))
    }

    @Test fun `replaceAll discards numbers that are no longer leads`() {
        val matcher = LeadMatcher(MemoryStore())
        matcher.replaceAll(listOf("9876543210" to asha))
        matcher.replaceAll(listOf("9000000000" to LeadRef("lead-2", "Ravi")))
        assertNull(matcher.match("9876543210"))
    }

    @Test fun `survives a restart by reloading from the store`() {
        val store = MemoryStore()
        LeadMatcher(store).replaceAll(listOf("9876543210" to LeadRef("lead-1", "Asha\tK\nS")))
        val reloaded = LeadMatcher(store).match("9876543210")
        assertEquals("lead-1", reloaded?.leadId)
        assertEquals("Asha K S", reloaded?.name) // tabs/newlines in names are flattened
    }
}
