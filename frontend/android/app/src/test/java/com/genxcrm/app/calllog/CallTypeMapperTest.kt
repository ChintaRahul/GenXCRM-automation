package com.genxcrm.app.calllog

import org.junit.Assert.assertEquals
import org.junit.Test

class CallTypeMapperTest {
    @Test fun `outgoing type is an outbound call`() {
        assertEquals("outbound", CallTypeMapper.direction(2))
    }

    @Test fun `incoming, missed, rejected and blocked types are all inbound`() {
        assertEquals("inbound", CallTypeMapper.direction(1))
        assertEquals("inbound", CallTypeMapper.direction(3))
        assertEquals("inbound", CallTypeMapper.direction(5))
        assertEquals("inbound", CallTypeMapper.direction(6))
    }

    @Test fun `a call with any duration connected`() {
        assertEquals("CONNECTED", CallTypeMapper.outcome(1))
        assertEquals("CONNECTED", CallTypeMapper.outcome(42))
    }

    @Test fun `zero duration never connected`() {
        assertEquals("NOT_CONNECTED", CallTypeMapper.outcome(0))
    }
}
