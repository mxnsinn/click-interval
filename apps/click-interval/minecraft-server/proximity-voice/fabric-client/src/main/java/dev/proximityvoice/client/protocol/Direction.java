package dev.proximityvoice.client.protocol;

public enum Direction {
    CLIENT_TO_SERVER(0x43545331),
    SERVER_TO_CLIENT(0x53544331);

    private final int nonceMarker;

    Direction(int nonceMarker) {
        this.nonceMarker = nonceMarker;
    }

    int nonceMarker() {
        return nonceMarker;
    }
}
