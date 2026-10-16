package dev.serverprotection.client;

import dev.serverprotection.fabric.attestation.AttestationProtocol;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class CompanionProtocolTest {
    @Test
    void companionResponseIsBoundToTheLatestServerNonce() {
        byte[] nonce = new byte[AttestationProtocol.NONCE_BYTES];
        nonce[0] = 42;
        byte[] response = AttestationProtocol.encodeReport(nonce, "1.0.0", List.of(
                new AttestationProtocol.ModEntry("Fabric-Loader", "0.19.5"),
                new AttestationProtocol.ModEntry("safe_mod", "1.2.3")));

        AttestationProtocol.Report report = AttestationProtocol.decodeReport(response, nonce);
        assertEquals(2, report.mods().size());
        assertTrue(report.mods().containsKey("fabric-loader"));
        assertFalse(report.truncated());

        byte[] staleNonce = nonce.clone();
        staleNonce[0] = 41;
        assertThrows(IllegalArgumentException.class,
                () -> AttestationProtocol.decodeReport(response, staleNonce));
    }
}
