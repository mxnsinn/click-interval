package dev.proximityvoice.client.core;

import java.util.Objects;

public final class ClientStateMachine {
    private ConnectionState state = ConnectionState.DISCONNECTED;
    private String detail = "";

    public synchronized ConnectionState state() {
        return state;
    }

    public synchronized String detail() {
        return detail;
    }

    public synchronized void beginNegotiation() {
        state = ConnectionState.NEGOTIATING;
        detail = "Waiting for the server voice relay";
    }

    public synchronized void beginAssociation() {
        require(ConnectionState.NEGOTIATING, ConnectionState.ASSOCIATING, ConnectionState.CONNECTED);
        state = ConnectionState.ASSOCIATING;
        detail = "Securing UDP voice transport";
    }

    public synchronized void connected() {
        require(ConnectionState.ASSOCIATING, ConnectionState.CONNECTED);
        state = ConnectionState.CONNECTED;
        detail = "Voice connected";
    }

    public synchronized void fail(String reason) {
        state = ConnectionState.ERROR;
        detail = clean(reason, "Voice connection failed");
    }

    public synchronized void disconnected() {
        state = ConnectionState.DISCONNECTED;
        detail = "";
    }

    private void require(ConnectionState... allowed) {
        for (ConnectionState candidate : allowed) {
            if (state == candidate) return;
        }
        throw new IllegalStateException("Invalid voice state transition from " + state);
    }

    private static String clean(String value, String fallback) {
        String text = Objects.toString(value, "").replaceAll("[\\p{Cntrl}]", " ").trim();
        if (text.isEmpty()) return fallback;
        return text.length() <= 160 ? text : text.substring(0, 160);
    }
}
