package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionContextPayload;
import io.netty.buffer.Unpooled;
import java.util.Collections;
import java.util.List;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class MentionPayloadTest {
    @Test void ownAliasesAndExplicitMembershipClearRoundTrip() {
        for (List<String> names : List.of(List.of("VRG", "Night Watch"), List.<String>of())) {
            var buffer = buffer();
            try {
                MentionContextPayload.CODEC.encode(buffer, new MentionContextPayload(names));
                assertEquals(names, MentionContextPayload.CODEC.decode(buffer).names());
                assertFalse(buffer.isReadable());
            } finally { buffer.release(); }
        }
    }

    @Test void oversizeCountsTrailingBytesAndInvalidAliasesFailClosed() {
        assertThrows(IllegalArgumentException.class, () -> new MentionContextPayload(Collections.nCopies(65, "VRG")));
        assertThrows(IllegalArgumentException.class, () -> new MentionContextPayload(List.of("a\nb")));
        for (int count : new int[]{-1, 65, Integer.MAX_VALUE}) {
            var buffer = buffer();
            try {
                buffer.writeVarInt(count);
                assertThrows(IllegalArgumentException.class, () -> MentionContextPayload.CODEC.decode(buffer));
            } finally { buffer.release(); }
        }
        var buffer = buffer();
        try {
            buffer.writeVarInt(0); buffer.writeByte(1);
            assertThrows(IllegalArgumentException.class, () -> MentionContextPayload.CODEC.decode(buffer));
        } finally { buffer.release(); }
    }

    @Test void payloadDefensivelyCopiesCallerList() {
        var names = new java.util.ArrayList<>(List.of("VRG"));
        var payload = new MentionContextPayload(names);
        names.clear();
        assertEquals(List.of("VRG"), payload.names());
        assertThrows(UnsupportedOperationException.class, () -> payload.names().add("NO"));
    }

    private static RegistryFriendlyByteBuf buffer() {
        return new RegistryFriendlyByteBuf(Unpooled.buffer(), RegistryAccess.EMPTY);
    }
}
