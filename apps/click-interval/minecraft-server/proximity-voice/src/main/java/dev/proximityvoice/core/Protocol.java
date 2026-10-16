package dev.proximityvoice.core;

public final class Protocol {
    public static final int MAGIC = 0x50564331; // PVC1
    public static final int CONTROL_MAGIC = 0x50564343; // PVCC
    public static final int VERSION = 1;
    public static final int HEADER_BYTES = 24;
    public static final int AUTH_TAG_BYTES = 16;
    public static final int MAX_DATAGRAM_BYTES = 1_200;
    public static final int MAX_CONTROL_MESSAGE_BYTES = 32_766;
    public static final int MAX_ROSTER_ENTRIES = 1_024;
    public static final int MAX_PLAINTEXT_BYTES = MAX_DATAGRAM_BYTES - HEADER_BYTES - AUTH_TAG_BYTES;
    public static final int MAX_OPUS_FRAME_BYTES = MAX_PLAINTEXT_BYTES - 16;
    public static final int KEY_BYTES = 32;
    public static final int CHALLENGE_BYTES = 16;
    public static final String CONTROL_CHANNEL = "proximityvoice:control";

    private Protocol() {}
}
