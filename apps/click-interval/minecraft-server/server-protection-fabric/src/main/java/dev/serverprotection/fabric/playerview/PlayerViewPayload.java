package dev.serverprotection.fabric.playerview;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Bounded server-to-client state used by the optional companion while an operator views a player.
 *
 * <p>Protocol 1 carried only the hotbar and off hand. Protocol 2 adds a read-only snapshot of the
 * target's inventory and armor. The client never sends an inventory action back to the server.</p>
 */
public record PlayerViewPayload(
        int protocolVersion,
        Action action,
        UUID sessionId,
        int sequence,
        int targetEntityId,
        UUID targetUuid,
        String targetName,
        List<ItemStack> inventory,
        List<ItemStack> armor,
        ItemStack offhand,
        int selectedSlot,
        float health,
        int foodLevel,
        float foodSaturation,
        float experienceProgress,
        int experienceLevel,
        int totalExperience,
        boolean swinging,
        InteractionHand swingHand,
        boolean usingItem,
        InteractionHand useHand
) implements CustomPacketPayload {
    public static final int LEGACY_PROTOCOL_VERSION = 1;
    public static final int PROTOCOL_VERSION = 2;
    public static final int HOTBAR_SIZE = 9;
    public static final int INVENTORY_SIZE = 36;
    public static final int ARMOR_SIZE = 4;
    public static final int MAX_TARGET_NAME_LENGTH = 64;
    public static final int MAX_PAYLOAD_BYTES = 1024 * 1024;
    public static final Type<PlayerViewPayload> LEGACY_TYPE = new Type<>(Identifier.fromNamespaceAndPath(
            "serverprotection", "player_view"));
    public static final Type<PlayerViewPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath(
            "serverprotection", "player_view_v2"));
    public static final StreamCodec<RegistryFriendlyByteBuf, PlayerViewPayload> LEGACY_CODEC =
            CustomPacketPayload.codec(PlayerViewPayload::writeLegacy, PlayerViewPayload::readLegacy);
    public static final StreamCodec<RegistryFriendlyByteBuf, PlayerViewPayload> CODEC =
            CustomPacketPayload.codec(PlayerViewPayload::writeCurrent, PlayerViewPayload::readCurrent);

    private static final UUID EMPTY_UUID = new UUID(0L, 0L);
    private static final int MAX_EXPERIENCE = 50_000_000;

    public enum Action {
        START(1),
        SNAPSHOT(2),
        STOP(3);

        private final int wireId;

        Action(int wireId) {
            this.wireId = wireId;
        }

        int wireId() {
            return wireId;
        }

        static Action fromWireId(int wireId) {
            return switch (wireId) {
                case 1 -> START;
                case 2 -> SNAPSHOT;
                case 3 -> STOP;
                default -> throw new IllegalArgumentException("Unknown player-view action: " + wireId);
            };
        }
    }

    public PlayerViewPayload {
        if (!supportsProtocol(protocolVersion)) {
            throw new IllegalArgumentException("Unsupported player-view protocol: " + protocolVersion);
        }
        action = Objects.requireNonNull(action, "action");
        sessionId = Objects.requireNonNull(sessionId, "sessionId");
        if (sequence < 0) throw new IllegalArgumentException("Negative player-view sequence");

        if (action == Action.STOP) {
            targetEntityId = -1;
            targetUuid = EMPTY_UUID;
            targetName = "";
            inventory = List.of();
            armor = List.of();
            offhand = ItemStack.EMPTY;
            selectedSlot = 0;
            health = 0.0F;
            foodLevel = 0;
            foodSaturation = 0.0F;
            experienceProgress = 0.0F;
            experienceLevel = 0;
            totalExperience = 0;
            swinging = false;
            swingHand = InteractionHand.MAIN_HAND;
            usingItem = false;
            useHand = InteractionHand.MAIN_HAND;
        } else {
            if (targetEntityId < 0) throw new IllegalArgumentException("Invalid target entity id");
            targetUuid = Objects.requireNonNull(targetUuid, "targetUuid");
            targetName = validateTargetName(targetName, protocolVersion);
            inventory = copyFixedList(inventory, INVENTORY_SIZE, "inventory");
            armor = copyFixedList(armor, ARMOR_SIZE, "armor");
            offhand = copyOrEmpty(offhand);
            if (selectedSlot < 0 || selectedSlot >= HOTBAR_SIZE) {
                throw new IllegalArgumentException("Invalid selected hotbar slot");
            }
            if (!Float.isFinite(health) || health < 0.0F || health > 1_000_000.0F) {
                throw new IllegalArgumentException("Invalid player-view health");
            }
            if (foodLevel < 0 || foodLevel > 20) {
                throw new IllegalArgumentException("Invalid player-view food level");
            }
            if (!Float.isFinite(foodSaturation) || foodSaturation < 0.0F || foodSaturation > 40.0F) {
                throw new IllegalArgumentException("Invalid player-view food saturation");
            }
            if (!Float.isFinite(experienceProgress) || experienceProgress < 0.0F || experienceProgress > 1.0F) {
                throw new IllegalArgumentException("Invalid player-view experience progress");
            }
            if (experienceLevel < 0 || experienceLevel > MAX_EXPERIENCE
                    || totalExperience < 0 || totalExperience > MAX_EXPERIENCE) {
                throw new IllegalArgumentException("Invalid player-view experience value");
            }
            swingHand = Objects.requireNonNull(swingHand, "swingHand");
            useHand = Objects.requireNonNull(useHand, "useHand");
        }
    }

    public static PlayerViewPayload start(
            UUID sessionId,
            int sequence,
            int targetEntityId,
            UUID targetUuid,
            String targetName,
            List<ItemStack> inventory,
            List<ItemStack> armor,
            ItemStack offhand,
            int selectedSlot,
            float health,
            int foodLevel,
            float foodSaturation,
            float experienceProgress,
            int experienceLevel,
            int totalExperience,
            boolean swinging,
            InteractionHand swingHand,
            boolean usingItem,
            InteractionHand useHand
    ) {
        return snapshot(Action.START, sessionId, sequence, targetEntityId, targetUuid, targetName,
                inventory, armor, offhand,
                selectedSlot, health, foodLevel, foodSaturation, experienceProgress, experienceLevel,
                totalExperience, swinging, swingHand, usingItem, useHand);
    }

    public static PlayerViewPayload snapshot(
            UUID sessionId,
            int sequence,
            int targetEntityId,
            UUID targetUuid,
            String targetName,
            List<ItemStack> inventory,
            List<ItemStack> armor,
            ItemStack offhand,
            int selectedSlot,
            float health,
            int foodLevel,
            float foodSaturation,
            float experienceProgress,
            int experienceLevel,
            int totalExperience,
            boolean swinging,
            InteractionHand swingHand,
            boolean usingItem,
            InteractionHand useHand
    ) {
        return snapshot(Action.SNAPSHOT, sessionId, sequence, targetEntityId, targetUuid, targetName,
                inventory, armor, offhand,
                selectedSlot, health, foodLevel, foodSaturation, experienceProgress, experienceLevel,
                totalExperience, swinging, swingHand, usingItem, useHand);
    }

    private static PlayerViewPayload snapshot(
            Action action,
            UUID sessionId,
            int sequence,
            int targetEntityId,
            UUID targetUuid,
            String targetName,
            List<ItemStack> inventory,
            List<ItemStack> armor,
            ItemStack offhand,
            int selectedSlot,
            float health,
            int foodLevel,
            float foodSaturation,
            float experienceProgress,
            int experienceLevel,
            int totalExperience,
            boolean swinging,
            InteractionHand swingHand,
            boolean usingItem,
            InteractionHand useHand
    ) {
        return new PlayerViewPayload(PROTOCOL_VERSION, action, sessionId, sequence, targetEntityId, targetUuid,
                targetName, inventory, armor, offhand, selectedSlot, health, foodLevel, foodSaturation,
                experienceProgress,
                experienceLevel, totalExperience, swinging, swingHand, usingItem, useHand);
    }

    public static PlayerViewPayload stop(UUID sessionId, int sequence) {
        return stop(PROTOCOL_VERSION, sessionId, sequence);
    }

    private static PlayerViewPayload stop(int protocolVersion, UUID sessionId, int sequence) {
        return new PlayerViewPayload(protocolVersion, Action.STOP, sessionId, sequence, -1, EMPTY_UUID,
                "", List.of(), List.of(), ItemStack.EMPTY, 0, 0.0F, 0, 0.0F, 0.0F, 0, 0,
                false, InteractionHand.MAIN_HAND, false, InteractionHand.MAIN_HAND);
    }

    /** The first nine entries of {@link #inventory()} are the target's hotbar. */
    public List<ItemStack> hotbar() {
        return inventory.size() < HOTBAR_SIZE ? List.of() : inventory.subList(0, HOTBAR_SIZE);
    }

    public boolean hasFullInventory() {
        return protocolVersion >= PROTOCOL_VERSION;
    }

    public static boolean supportsProtocol(int protocolVersion) {
        return protocolVersion >= LEGACY_PROTOCOL_VERSION && protocolVersion <= PROTOCOL_VERSION;
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return protocolVersion == LEGACY_PROTOCOL_VERSION ? LEGACY_TYPE : TYPE;
    }

    private void writeLegacy(RegistryFriendlyByteBuf output) {
        if (protocolVersion != LEGACY_PROTOCOL_VERSION) {
            throw new IllegalArgumentException("A v2 player-view payload cannot use the legacy channel");
        }
        write(output);
    }

    private void writeCurrent(RegistryFriendlyByteBuf output) {
        if (protocolVersion != PROTOCOL_VERSION) {
            throw new IllegalArgumentException("A legacy player-view payload cannot use the v2 channel");
        }
        write(output);
    }

    private void write(RegistryFriendlyByteBuf output) {
        output.writeVarInt(protocolVersion);
        output.writeByte(action.wireId());
        output.writeUUID(sessionId);
        output.writeVarInt(sequence);
        if (action == Action.STOP) return;

        output.writeVarInt(targetEntityId);
        output.writeUUID(targetUuid);
        if (protocolVersion == LEGACY_PROTOCOL_VERSION) {
            output.writeByte(HOTBAR_SIZE);
            for (ItemStack stack : hotbar()) {
                ItemStack.OPTIONAL_STREAM_CODEC.encode(output, stack);
            }
        } else {
            output.writeUtf(targetName, MAX_TARGET_NAME_LENGTH);
            output.writeByte(INVENTORY_SIZE);
            for (ItemStack stack : inventory) {
                ItemStack.OPTIONAL_STREAM_CODEC.encode(output, stack);
            }
            output.writeByte(ARMOR_SIZE);
            for (ItemStack stack : armor) {
                ItemStack.OPTIONAL_STREAM_CODEC.encode(output, stack);
            }
        }
        ItemStack.OPTIONAL_STREAM_CODEC.encode(output, offhand);
        output.writeByte(selectedSlot);
        output.writeFloat(health);
        output.writeByte(foodLevel);
        output.writeFloat(foodSaturation);
        output.writeFloat(experienceProgress);
        output.writeVarInt(experienceLevel);
        output.writeVarInt(totalExperience);
        output.writeBoolean(swinging);
        output.writeByte(handId(swingHand));
        output.writeBoolean(usingItem);
        output.writeByte(handId(useHand));
    }

    private static PlayerViewPayload readLegacy(RegistryFriendlyByteBuf input) {
        return read(input, LEGACY_PROTOCOL_VERSION);
    }

    private static PlayerViewPayload readCurrent(RegistryFriendlyByteBuf input) {
        return read(input, PROTOCOL_VERSION);
    }

    private static PlayerViewPayload read(RegistryFriendlyByteBuf input, int expectedProtocol) {
        int encodedBytes = input.readableBytes();
        if (encodedBytes < 19 || encodedBytes > MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Invalid player-view payload length: " + encodedBytes);
        }
        int protocolVersion = input.readVarInt();
        if (!supportsProtocol(protocolVersion)) {
            throw new IllegalArgumentException("Unsupported player-view protocol: " + protocolVersion);
        }
        if (protocolVersion != expectedProtocol) {
            throw new IllegalArgumentException("Player-view channel/protocol mismatch");
        }
        Action action = Action.fromWireId(input.readUnsignedByte());
        UUID sessionId = input.readUUID();
        int sequence = input.readVarInt();
        if (action == Action.STOP) {
            requireFullyRead(input);
            return stop(protocolVersion, sessionId, sequence);
        }

        int targetEntityId = input.readVarInt();
        UUID targetUuid = input.readUUID();
        String targetName = "";
        ArrayList<ItemStack> inventory = emptyItems(INVENTORY_SIZE);
        ArrayList<ItemStack> armor = emptyItems(ARMOR_SIZE);
        if (protocolVersion == LEGACY_PROTOCOL_VERSION) {
            int slots = input.readUnsignedByte();
            if (slots != HOTBAR_SIZE) {
                throw new IllegalArgumentException("Invalid player-view hotbar size: " + slots);
            }
            for (int index = 0; index < HOTBAR_SIZE; index++) {
                inventory.set(index, ItemStack.OPTIONAL_STREAM_CODEC.decode(input));
            }
        } else {
            targetName = input.readUtf(MAX_TARGET_NAME_LENGTH);
            int slots = input.readUnsignedByte();
            if (slots != INVENTORY_SIZE) {
                throw new IllegalArgumentException("Invalid player-view inventory size: " + slots);
            }
            inventory.clear();
            for (int index = 0; index < INVENTORY_SIZE; index++) {
                inventory.add(ItemStack.OPTIONAL_STREAM_CODEC.decode(input));
            }
            int armorSlots = input.readUnsignedByte();
            if (armorSlots != ARMOR_SIZE) {
                throw new IllegalArgumentException("Invalid player-view armor size: " + armorSlots);
            }
            armor.clear();
            for (int index = 0; index < ARMOR_SIZE; index++) {
                armor.add(ItemStack.OPTIONAL_STREAM_CODEC.decode(input));
            }
        }
        ItemStack offhand = ItemStack.OPTIONAL_STREAM_CODEC.decode(input);
        int selectedSlot = input.readUnsignedByte();
        float health = input.readFloat();
        int foodLevel = input.readUnsignedByte();
        float foodSaturation = input.readFloat();
        float experienceProgress = input.readFloat();
        int experienceLevel = input.readVarInt();
        int totalExperience = input.readVarInt();
        boolean swinging = input.readBoolean();
        InteractionHand swingHand = readHand(input.readUnsignedByte());
        boolean usingItem = input.readBoolean();
        InteractionHand useHand = readHand(input.readUnsignedByte());
        requireFullyRead(input);

        return new PlayerViewPayload(protocolVersion, action, sessionId, sequence, targetEntityId, targetUuid,
                targetName, inventory, armor, offhand, selectedSlot, health, foodLevel, foodSaturation,
                experienceProgress,
                experienceLevel, totalExperience, swinging, swingHand, usingItem, useHand);
    }

    private static void requireFullyRead(RegistryFriendlyByteBuf input) {
        if (input.isReadable()) {
            throw new IllegalArgumentException("Trailing bytes in player-view payload");
        }
    }

    private static int handId(InteractionHand hand) {
        return hand == InteractionHand.OFF_HAND ? 1 : 0;
    }

    private static InteractionHand readHand(int id) {
        return switch (id) {
            case 0 -> InteractionHand.MAIN_HAND;
            case 1 -> InteractionHand.OFF_HAND;
            default -> throw new IllegalArgumentException("Invalid player-view hand: " + id);
        };
    }

    private static ItemStack copyOrEmpty(ItemStack stack) {
        return stack == null || stack.isEmpty() ? ItemStack.EMPTY : stack.copy();
    }

    private static List<ItemStack> copyFixedList(List<ItemStack> stacks, int expectedSize, String label) {
        if (stacks == null || stacks.size() != expectedSize) {
            throw new IllegalArgumentException("Player-view snapshots require exactly "
                    + expectedSize + " " + label + " slots");
        }
        ArrayList<ItemStack> safe = new ArrayList<>(expectedSize);
        for (ItemStack stack : stacks) safe.add(copyOrEmpty(stack));
        return List.copyOf(safe);
    }

    private static ArrayList<ItemStack> emptyItems(int size) {
        ArrayList<ItemStack> result = new ArrayList<>(size);
        for (int index = 0; index < size; index++) result.add(ItemStack.EMPTY);
        return result;
    }

    private static String validateTargetName(String value, int protocolVersion) {
        String targetName = value == null ? "" : value.trim();
        if (targetName.length() > MAX_TARGET_NAME_LENGTH) {
            throw new IllegalArgumentException("Player-view target name is too long");
        }
        for (int index = 0; index < targetName.length(); index++) {
            if (Character.isISOControl(targetName.charAt(index))) {
                throw new IllegalArgumentException("Player-view target name contains control characters");
            }
        }
        if (protocolVersion >= PROTOCOL_VERSION && targetName.isEmpty()) {
            throw new IllegalArgumentException("Player-view target name is required");
        }
        return targetName;
    }
}
