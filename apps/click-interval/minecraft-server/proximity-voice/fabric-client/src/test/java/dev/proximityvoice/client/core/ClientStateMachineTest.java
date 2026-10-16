package dev.proximityvoice.client.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ClientStateMachineTest {
    @Test
    void followsHandshakeLifecycle() {
        ClientStateMachine state = new ClientStateMachine();
        state.beginNegotiation();
        assertEquals(ConnectionState.NEGOTIATING, state.state());
        state.beginAssociation();
        assertEquals(ConnectionState.ASSOCIATING, state.state());
        state.connected();
        assertEquals(ConnectionState.CONNECTED, state.state());
        state.disconnected();
        assertEquals(ConnectionState.DISCONNECTED, state.state());
    }

    @Test
    void rejectsConnectedWithoutAssociation() {
        ClientStateMachine state = new ClientStateMachine();
        assertThrows(IllegalStateException.class, state::connected);
    }

    @Test
    void boundsUntrustedErrorText() {
        ClientStateMachine state = new ClientStateMachine();
        state.fail("x".repeat(300) + "\n");
        assertEquals(ConnectionState.ERROR, state.state());
        assertEquals(160, state.detail().length());
    }
}
