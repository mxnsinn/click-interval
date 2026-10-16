package dev.serverprotection.client;

import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import io.netty.buffer.Unpooled;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PlayerViewPayloadTest {
    private static final UUID SESSION = UUID.fromString("b567142d-20a0-4c90-b19f-76c413f1a60a");
    private static final UUID TARGET = UUID.fromString("749f8c5d-794f-4ee0-a635-61e97896075b");

    @Test
    void snapshotCarriesFixedReadOnlyInventoryAndArmor() {
        PlayerViewPayload payload = snapshot(
                Collections.nCopies(PlayerViewPayload.INVENTORY_SIZE, ItemStack.EMPTY),
                Collections.nCopies(PlayerViewPayload.ARMOR_SIZE, ItemStack.EMPTY),
                8);

        assertEquals(PlayerViewPayload.Action.SNAPSHOT, payload.action());
        assertEquals(9, payload.hotbar().size());
        assertEquals(36, payload.inventory().size());
        assertEquals(4, payload.armor().size());
        assertEquals(8, payload.selectedSlot());
        assertEquals(20.0F, payload.health());
        assertTrue(payload.hasFullInventory());
    }

    @Test
    void rejectsOversizedOrMalformedStateBeforeItCanReachTheClient() {
        assertThrows(IllegalArgumentException.class,
                () -> snapshot(Collections.nCopies(35, ItemStack.EMPTY),
                        Collections.nCopies(4, ItemStack.EMPTY), 0));
        assertThrows(IllegalArgumentException.class,
                () -> snapshot(Collections.nCopies(36, ItemStack.EMPTY),
                        Collections.nCopies(3, ItemStack.EMPTY), 0));
        assertThrows(IllegalArgumentException.class,
                () -> snapshot(Collections.nCopies(36, ItemStack.EMPTY),
                        Collections.nCopies(4, ItemStack.EMPTY), 9));
        assertThrows(IllegalArgumentException.class,
                () -> new PlayerViewPayload(
                        PlayerViewPayload.PROTOCOL_VERSION,
                        PlayerViewPayload.Action.SNAPSHOT,
                        SESSION,
                        1,
                        14,
                        TARGET,
                        "Target",
                        Collections.nCopies(36, ItemStack.EMPTY),
                        Collections.nCopies(4, ItemStack.EMPTY),
                        ItemStack.EMPTY,
                        0,
                        Float.NaN,
                        20,
                        5.0F,
                        0.5F,
                        12,
                        300,
                        false,
                        InteractionHand.MAIN_HAND,
                        false,
                        InteractionHand.MAIN_HAND));
    }

    @Test
    void stopCarriesNoMirroredPlayerState() {
        PlayerViewPayload stop = PlayerViewPayload.stop(SESSION, 27);

        assertEquals(PlayerViewPayload.Action.STOP, stop.action());
        assertEquals(27, stop.sequence());
        assertTrue(stop.hotbar().isEmpty());
        assertTrue(stop.inventory().isEmpty());
        assertTrue(stop.armor().isEmpty());
        assertTrue(stop.offhand().isEmpty());
        assertEquals(-1, stop.targetEntityId());
    }

    @Test
    void legacyProtocolStillExposesItsHotbarWithoutClaimingAFullInventory() {
        PlayerViewPayload legacy = legacySnapshot();

        assertEquals(PlayerViewPayload.HOTBAR_SIZE, legacy.hotbar().size());
        assertEquals(PlayerViewPayload.INVENTORY_SIZE, legacy.inventory().size());
        assertTrue(!legacy.hasFullInventory());
        assertTrue(PlayerViewPayload.supportsProtocol(PlayerViewPayload.LEGACY_PROTOCOL_VERSION));
    }

    @Test
    void legacyAndCurrentChannelsRoundTripIndependently() {
        assertNotEquals(PlayerViewPayload.LEGACY_TYPE.id(), PlayerViewPayload.TYPE.id());

        PlayerViewPayload legacy = legacySnapshot();
        RegistryFriendlyByteBuf legacyBuffer = new RegistryFriendlyByteBuf(
                Unpooled.buffer(), RegistryAccess.EMPTY);
        try {
            PlayerViewPayload.LEGACY_CODEC.encode(legacyBuffer, legacy);
            PlayerViewPayload decoded = PlayerViewPayload.LEGACY_CODEC.decode(legacyBuffer);
            assertEquals(PlayerViewPayload.LEGACY_PROTOCOL_VERSION, decoded.protocolVersion());
            assertEquals(PlayerViewPayload.LEGACY_TYPE, decoded.type());
            assertEquals(PlayerViewPayload.HOTBAR_SIZE, decoded.hotbar().size());
        } finally {
            legacyBuffer.release();
        }

        PlayerViewPayload current = snapshot(
                Collections.nCopies(36, ItemStack.EMPTY),
                Collections.nCopies(4, ItemStack.EMPTY),
                3);
        RegistryFriendlyByteBuf currentBuffer = new RegistryFriendlyByteBuf(
                Unpooled.buffer(), RegistryAccess.EMPTY);
        try {
            PlayerViewPayload.CODEC.encode(currentBuffer, current);
            PlayerViewPayload decoded = PlayerViewPayload.CODEC.decode(currentBuffer);
            assertEquals(PlayerViewPayload.PROTOCOL_VERSION, decoded.protocolVersion());
            assertEquals(PlayerViewPayload.TYPE, decoded.type());
            assertEquals("Target", decoded.targetName());
            assertEquals(PlayerViewPayload.INVENTORY_SIZE, decoded.inventory().size());
            assertEquals(PlayerViewPayload.ARMOR_SIZE, decoded.armor().size());
        } finally {
            currentBuffer.release();
        }

        assertThrows(IllegalArgumentException.class, () -> {
            RegistryFriendlyByteBuf wrongChannel = new RegistryFriendlyByteBuf(
                    Unpooled.buffer(), RegistryAccess.EMPTY);
            try {
                PlayerViewPayload.LEGACY_CODEC.encode(wrongChannel, current);
            } finally {
                wrongChannel.release();
            }
        });
    }

    private static PlayerViewPayload legacySnapshot() {
        return new PlayerViewPayload(
                PlayerViewPayload.LEGACY_PROTOCOL_VERSION,
                PlayerViewPayload.Action.SNAPSHOT,
                SESSION,
                4,
                14,
                TARGET,
                "",
                Collections.nCopies(PlayerViewPayload.INVENTORY_SIZE, ItemStack.EMPTY),
                Collections.nCopies(PlayerViewPayload.ARMOR_SIZE, ItemStack.EMPTY),
                ItemStack.EMPTY,
                2,
                20.0F,
                20,
                5.0F,
                0.5F,
                7,
                100,
                false,
                InteractionHand.MAIN_HAND,
                false,
                InteractionHand.MAIN_HAND);
    }

    private static PlayerViewPayload snapshot(
            List<ItemStack> inventory,
            List<ItemStack> armor,
            int selectedSlot
    ) {
        return PlayerViewPayload.snapshot(
                SESSION,
                5,
                14,
                TARGET,
                "Target",
                inventory,
                armor,
                ItemStack.EMPTY,
                selectedSlot,
                20.0F,
                17,
                3.5F,
                0.45F,
                12,
                300,
                false,
                InteractionHand.MAIN_HAND,
                false,
                InteractionHand.MAIN_HAND);
    }
}
