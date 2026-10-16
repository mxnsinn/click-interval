package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class ArrivalReadinessTest {
    @Test void initialTeleportAckDoesNotProveLaterChunksWereDelivered() {
        ArrivalReadiness state = new ArrivalReadiness(0);
        assertFalse(state.acknowledge(true));
        assertEquals(ArrivalReadiness.Step.WAIT_FOR_CHUNKS, state.poll(1, false));
        assertEquals(ArrivalReadiness.Step.SEND_POSITION_BARRIER, state.poll(2, true));
        state.barrierSent();
        assertFalse(state.acknowledge(false), "a stale position ACK is insufficient");
        assertEquals(ArrivalReadiness.Step.WAIT_FOR_ACK, state.poll(3, true));
        assertTrue(state.acknowledge(true));
        assertEquals(ArrivalReadiness.Step.COMPLETE, state.poll(3, true));
    }
    @Test void healthyDeliveryHasNoFixedDelayOrFallGrace() {
        ArrivalReadiness state = new ArrivalReadiness(100);
        assertEquals(ArrivalReadiness.Step.SEND_POSITION_BARRIER, state.poll(100, true));
        state.barrierSent();
        assertTrue(state.acknowledge(true));
        assertEquals(ArrivalReadiness.Step.COMPLETE, state.poll(100, true));
    }
    @Test void withholdingChunksOrAcknowledgementCannotFreezeAPlayerIndefinitely() {
        ArrivalReadiness chunks = new ArrivalReadiness(0);
        ArrivalReadiness ack = new ArrivalReadiness(0);
        ack.barrierSent();
        assertEquals(ArrivalReadiness.Step.TIMED_OUT, chunks.poll(ArrivalReadiness.TIMEOUT_MILLIS, false));
        assertEquals(ArrivalReadiness.Step.TIMED_OUT, ack.poll(ArrivalReadiness.TIMEOUT_MILLIS, true));
    }
}
