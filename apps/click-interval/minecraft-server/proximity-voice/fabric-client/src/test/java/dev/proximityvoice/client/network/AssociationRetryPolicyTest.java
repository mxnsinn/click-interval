package dev.proximityvoice.client.network;

import dev.proximityvoice.client.core.ClientStateMachine;
import dev.proximityvoice.client.core.ConnectionState;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AssociationRetryPolicyTest {
    @Test
    void retriesDroppedAssociateAndDroppedAcknowledgementWithFreshAttempts() {
        ClientStateMachine state = new ClientStateMachine();
        state.beginNegotiation();
        state.beginAssociation();
        AssociationRetryPolicy retry = new AssociationRetryPolicy(1_000L, 250L, 2_000L, 10_000L, 7);

        // Attempt one (ASSOCIATE dropped).
        assertEquals(AssociationRetryPolicy.Decision.SEND, retry.poll(1_000L));
        retry.attempted(1_000L);
        assertEquals(AssociationRetryPolicy.Decision.WAIT, retry.poll(1_249L));

        // Attempt two reaches the relay, but its ACK is dropped.
        assertEquals(AssociationRetryPolicy.Decision.SEND, retry.poll(1_250L));
        retry.attempted(1_250L);
        assertEquals(AssociationRetryPolicy.Decision.WAIT, retry.poll(1_749L));

        // Attempt three and its ACK arrive; the actual transport performs this transition.
        assertEquals(AssociationRetryPolicy.Decision.SEND, retry.poll(1_750L));
        retry.attempted(1_750L);
        state.connected();

        assertEquals(3, retry.attempts());
        assertEquals(ConnectionState.CONNECTED, state.state());
    }

    @Test
    void boundsBackoffAndTimesOutAfterFinalAcknowledgementWindow() {
        AssociationRetryPolicy retry = new AssociationRetryPolicy(0L, 250L, 2_000L, 10_000L, 7);
        long[] attempts = {0L, 250L, 750L, 1_750L, 3_750L, 5_750L, 7_750L};
        for (long now : attempts) {
            assertEquals(AssociationRetryPolicy.Decision.SEND, retry.poll(now));
            retry.attempted(now);
        }
        assertEquals(9_750L, retry.nextAttemptMillis());
        assertEquals(AssociationRetryPolicy.Decision.WAIT, retry.poll(9_749L));
        assertEquals(AssociationRetryPolicy.Decision.TIMED_OUT, retry.poll(9_750L));
    }

    @Test
    void endpointRecoveryUsesConnectedToAssociatingToConnectedTransition() {
        ClientStateMachine state = new ClientStateMachine();
        state.beginNegotiation();
        state.beginAssociation();
        state.connected();

        // A keepalive silence causes the transport to bind a fresh socket and securely associate it.
        state.beginAssociation();
        assertEquals(ConnectionState.ASSOCIATING, state.state());
        state.connected();
        assertEquals(ConnectionState.CONNECTED, state.state());
    }
}
