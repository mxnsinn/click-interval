package com.clickinterval.villagertrades.network;

import io.netty.buffer.Unpooled;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class CyclePayloadTest {
    @Test void requestRoundTripRemainsSmallAndHasNoClientSpecifiedOffersOrEntity() {
        for (var packet : new CycleRequest[] {new CycleRequest(1, 0, false), new CycleRequest(100, Long.MIN_VALUE, true)}) {
            var buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), RegistryAccess.EMPTY);
            try {
                CycleRequest.CODEC.encode(buffer, packet);
                assertTrue(buffer.readableBytes() <= 14);
                assertEquals(packet, CycleRequest.CODEC.decode(buffer));
                assertEquals(0, buffer.readableBytes());
            } finally { buffer.release(); }
        }
    }
    @Test void responseRoundTripAndTruncatedPayloadFailClosed() {
        var packet = new CycleStatus(12, Long.MAX_VALUE, false);
        var buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), RegistryAccess.EMPTY);
        try {
            CycleStatus.CODEC.encode(buffer, packet);
            assertTrue(buffer.readableBytes() <= 14);
            assertEquals(packet, CycleStatus.CODEC.decode(buffer));
            assertThrows(IndexOutOfBoundsException.class, () -> CycleStatus.CODEC.decode(buffer));
        } finally { buffer.release(); }
    }
}
