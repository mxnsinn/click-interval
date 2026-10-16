package dev.proximityvoice.core;

import java.net.SocketAddress;

public record OutboundDatagram(SocketAddress destination, byte[] data) {
    public OutboundDatagram {
        if (destination == null) throw new IllegalArgumentException("destination is required");
        if (data == null || data.length == 0 || data.length > Protocol.MAX_DATAGRAM_BYTES) {
            throw new IllegalArgumentException("invalid datagram");
        }
        data = data.clone();
    }

    @Override
    public byte[] data() {
        return data.clone();
    }
}
