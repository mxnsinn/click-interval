package dev.serverprotection.client;

import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import net.minecraft.client.CameraType;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Input;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.lang.reflect.Method;

/** Maintains a small, entirely client-side mirror for an authorized first-person player view. */
final class PlayerViewClientSession {
    private static final int STALE_TICKS = 20 * 30;
    private static final int TARGET_STATUS_INTERVAL_TICKS = 20 * 2;
    private static final int MAX_QUEUED_CLICKS_TO_DRAIN = 64;

    private final Logger logger;
    private Active active;
    private long clientTick;

    PlayerViewClientSession(Logger logger) {
        this.logger = logger;
    }

    void accept(PlayerViewPayload payload, Minecraft minecraft) {
        if (!PlayerViewPayload.supportsProtocol(payload.protocolVersion())) return;

        Active current = active;
        if (payload.action() == PlayerViewPayload.Action.STOP) {
            if (current != null && current.sessionId.equals(payload.sessionId())
                    && payload.sequence() >= current.sequence) {
                clear(minecraft, "server stop");
            }
            return;
        }

        LocalPlayer localPlayer = minecraft.player;
        if (localPlayer == null || minecraft.level == null) return;

        if (payload.action() == PlayerViewPayload.Action.START) {
            if (current != null && current.sessionId.equals(payload.sessionId())
                    && payload.sequence() <= current.sequence) {
                return;
            }
            if (current != null) clear(minecraft, "superseded session");
            active = new Active(
                    payload.sessionId(),
                    payload.sequence(),
                    payload,
                    LocalSnapshot.capture(localPlayer, minecraft.options.getCameraType()),
                    clientTick,
                    false,
                    null,
                    clientTick);
            minecraft.options.setCameraType(CameraType.FIRST_PERSON);
            apply(minecraft);
            logger.info("Started first-person player view for {}", payload.targetUuid());
            return;
        }

        if (current == null || !current.sessionId.equals(payload.sessionId())
                || payload.sequence() <= current.sequence) {
            return;
        }
        current.sequence = payload.sequence();
        current.payload = payload;
        current.lastPayloadTick = clientTick;
        apply(minecraft);
    }

    void beforeClientTick(Minecraft minecraft) {
        clientTick++;
        if (active == null) return;
        if (minecraft.player == null || minecraft.level == null || minecraft.getConnection() == null) {
            clear(minecraft, "connection unavailable");
            return;
        }
        if (clientTick - active.lastPayloadTick > STALE_TICKS) {
            minecraft.player.sendOverlayMessage(Component.literal(
                    "Player view stopped because the server stopped sending updates."));
            clear(minecraft, "stale session");
            return;
        }
        handleInventoryToggle(minecraft);
        lockInput(minecraft);
    }

    void afterClientTick(Minecraft minecraft) {
        if (active == null) return;
        lockInput(minecraft);
        apply(minecraft);
    }

    void disconnected(Minecraft minecraft) {
        clear(minecraft, "disconnect");
    }

    boolean isActive() {
        return active != null;
    }

    AbstractClientPlayer viewedPlayer(Minecraft minecraft) {
        Active current = active;
        return current == null ? null : findTarget(minecraft, current.payload);
    }

    PlayerViewPayload inventoryPayload(UUID sessionId) {
        Active current = active;
        return current != null && current.sessionId.equals(sessionId) ? current.payload : null;
    }

    String inventoryTargetName(UUID sessionId, Minecraft minecraft) {
        PlayerViewPayload payload = inventoryPayload(sessionId);
        if (payload == null) return "Player";
        if (!payload.targetName().isBlank()) return payload.targetName();
        AbstractClientPlayer target = findTarget(minecraft, payload);
        return target == null ? "Player" : target.getGameProfile().name();
    }

    void inventoryScreenRemoved(PlayerViewInventoryScreen screen) {
        Active current = active;
        if (current != null && current.inventoryScreen == screen) {
            current.inventoryScreen = null;
            current.inventoryToggleCooldownTicks = 2;
        }
    }

    private void apply(Minecraft minecraft) {
        Active current = active;
        LocalPlayer localPlayer = minecraft.player;
        if (current == null || localPlayer == null || minecraft.level == null) return;

        AbstractClientPlayer target = findTarget(minecraft, current.payload);
        if (target == null) {
            if (clientTick - current.lastTargetStatusTick >= TARGET_STATUS_INTERVAL_TICKS) {
                minecraft.player.sendOverlayMessage(Component.literal(
                        "Loading the viewed player's world…"));
                current.lastTargetStatusTick = clientTick;
                current.targetUnavailableNoticeShown = true;
            }
            return;
        }
        current.lastTargetSeenTick = clientTick;
        if (current.targetUnavailableNoticeShown) {
            minecraft.player.sendOverlayMessage(Component.empty());
            current.targetUnavailableNoticeShown = false;
        }

        mirrorInventory(target.getInventory(), current.payload.hotbar(), current.payload.selectedSlot());
        target.setItemInHand(InteractionHand.OFF_HAND, current.payload.offhand().copy());
        target.setHealth(current.payload.health());
        target.getFoodData().setFoodLevel(current.payload.foodLevel());
        target.getFoodData().setSaturation(current.payload.foodSaturation());
        target.experienceProgress = current.payload.experienceProgress();
        target.experienceLevel = current.payload.experienceLevel();
        target.totalExperience = current.payload.totalExperience();

        // Vanilla's first-person hand renderer reads Minecraft.player rather than the camera entity.
        // Mirroring only the hotbar/offhand makes the held tool accurate without exposing inventory.
        mirrorInventory(localPlayer.getInventory(), current.payload.hotbar(), current.payload.selectedSlot());
        localPlayer.setItemInHand(InteractionHand.OFF_HAND, current.payload.offhand().copy());
        localPlayer.setHealth(current.payload.health());
        localPlayer.getFoodData().setFoodLevel(current.payload.foodLevel());
        localPlayer.getFoodData().setSaturation(current.payload.foodSaturation());
        localPlayer.experienceProgress = current.payload.experienceProgress();
        localPlayer.experienceLevel = current.payload.experienceLevel();
        localPlayer.totalExperience = current.payload.totalExperience();

        if (minecraft.getCameraEntity() != target) {
            minecraft.setCameraEntity(target);
        }
        minecraft.options.setCameraType(CameraType.FIRST_PERSON);
        applyHandAnimation(localPlayer, current);
    }

    private void handleInventoryToggle(Minecraft minecraft) {
        Active current = active;
        if (current == null) return;
        if (current.inventoryToggleCooldownTicks > 0) {
            current.inventoryToggleCooldownTicks--;
            clear(minecraft.options.keyInventory);
            return;
        }
        if (!minecraft.options.keyInventory.consumeClick()) return;
        clear(minecraft.options.keyInventory);
        if (current.inventoryScreen != null) return;
        PlayerViewInventoryScreen screen = new PlayerViewInventoryScreen(this, current.sessionId);
        current.inventoryScreen = screen;
        minecraft.setScreenAndShow(screen);
    }

    private static AbstractClientPlayer findTarget(Minecraft minecraft, PlayerViewPayload payload) {
        Entity byId = minecraft.level == null ? null : minecraft.level.getEntity(payload.targetEntityId());
        if (byId instanceof AbstractClientPlayer player && player.getUUID().equals(payload.targetUuid())) {
            return player;
        }
        if (minecraft.level == null) return null;
        for (AbstractClientPlayer player : minecraft.level.players()) {
            if (player.getUUID().equals(payload.targetUuid())) return player;
        }
        return null;
    }

    private static void mirrorInventory(Inventory inventory, List<ItemStack> hotbar, int selectedSlot) {
        for (int index = 0; index < PlayerViewPayload.HOTBAR_SIZE; index++) {
            inventory.setItem(index, hotbar.get(index).copy());
        }
        inventory.setSelectedSlot(selectedSlot);
    }

    private static void applyHandAnimation(LocalPlayer localPlayer, Active current) {
        PlayerViewPayload payload = current.payload;
        if (payload.swinging() && (!current.wasSwinging || current.lastSwingHand != payload.swingHand())) {
            ItemStack handStack = localPlayer.getItemInHand(payload.swingHand());
            playLocalSwing(localPlayer, payload.swingHand(), handStack);
        }
        current.wasSwinging = payload.swinging();
        current.lastSwingHand = payload.swingHand();

        if (payload.usingItem()) {
            if (!localPlayer.isUsingItem() || localPlayer.getUsedItemHand() != payload.useHand()) {
                localPlayer.stopUsingItem();
                localPlayer.startUsingItem(payload.useHand());
            }
        } else if (localPlayer.isUsingItem()) {
            localPlayer.stopUsingItem();
        }
    }

    /** Minecraft 26.3 added an explicit SwingAnimation parameter; keep one small adapter for 26.2. */
    private static void playLocalSwing(LocalPlayer player, InteractionHand hand, ItemStack stack) {
        try {
            for (Method method : player.getClass().getMethods()) {
                if (!method.getName().equals("swing")) continue;
                Class<?>[] parameters = method.getParameterTypes();
                if (parameters.length == 2
                        && parameters[0] == InteractionHand.class
                        && parameters[1] == boolean.class) {
                    method.invoke(player, hand, true);
                    return;
                }
                if (parameters.length == 3
                        && parameters[0] == InteractionHand.class
                        && parameters[2] == boolean.class) {
                    Method animationGetter = stack.getClass().getMethod("getAttackAnimation");
                    Object animation = animationGetter.invoke(stack);
                    method.invoke(player, hand, animation, true);
                    return;
                }
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Rendering a missed swing is preferable to risking a client disconnect on an API mismatch.
        }
    }

    private static void lockInput(Minecraft minecraft) {
        LocalPlayer player = minecraft.player;
        if (player != null && player.input != null) {
            player.input.keyPresses = Input.EMPTY;
        }

        Options options = minecraft.options;
        clear(options.keyUp);
        clear(options.keyDown);
        clear(options.keyLeft);
        clear(options.keyRight);
        clear(options.keyJump);
        clear(options.keyShift);
        clear(options.keySprint);
        clear(options.keyAttack);
        clear(options.keyUse);
        clear(options.keyPickItem);
        clear(options.keyDrop);
        clear(options.keySwapOffhand);
        clear(options.keyInventory);
        clear(options.keyAdvancements);
        clear(options.keyTogglePerspective);
        clear(options.keySaveHotbarActivator);
        clear(options.keyLoadHotbarActivator);
        for (KeyMapping mapping : options.keyHotbarSlots) clear(mapping);
        // keyChat and keyCommand intentionally remain available, including /unspectate.
    }

    private static void clear(KeyMapping mapping) {
        mapping.setDown(false);
        int drained = 0;
        while (drained++ < MAX_QUEUED_CLICKS_TO_DRAIN && mapping.consumeClick()) {
            // Drain clicks queued before the view lock was applied.
        }
    }

    private void clear(Minecraft minecraft, String reason) {
        Active previous = active;
        active = null;
        if (previous == null) return;

        if (previous.inventoryScreen != null) {
            previous.inventoryScreen = null;
            minecraft.setScreenAndShow(null);
        }

        LocalPlayer player = minecraft.player;
        if (player != null) {
            previous.localSnapshot.restore(player);
            minecraft.setCameraEntity(player);
            if (previous.localSnapshot.usingItem) {
                player.startUsingItem(previous.localSnapshot.useHand);
            } else {
                player.stopUsingItem();
            }
        }
        minecraft.options.setCameraType(previous.localSnapshot.cameraType);
        logger.info("Stopped first-person player view ({})", reason);
    }

    private static final class Active {
        private final UUID sessionId;
        private int sequence;
        private PlayerViewPayload payload;
        private final LocalSnapshot localSnapshot;
        private long lastPayloadTick;
        private boolean wasSwinging;
        private InteractionHand lastSwingHand;
        private long lastTargetSeenTick;
        private long lastTargetStatusTick;
        private boolean targetUnavailableNoticeShown;
        private PlayerViewInventoryScreen inventoryScreen;
        private int inventoryToggleCooldownTicks;

        private Active(
                UUID sessionId,
                int sequence,
                PlayerViewPayload payload,
                LocalSnapshot localSnapshot,
                long lastPayloadTick,
                boolean wasSwinging,
                InteractionHand lastSwingHand,
                long lastTargetSeenTick
        ) {
            this.sessionId = sessionId;
            this.sequence = sequence;
            this.payload = payload;
            this.localSnapshot = localSnapshot;
            this.lastPayloadTick = lastPayloadTick;
            this.wasSwinging = wasSwinging;
            this.lastSwingHand = lastSwingHand;
            this.lastTargetSeenTick = lastTargetSeenTick;
            this.lastTargetStatusTick = lastTargetSeenTick - TARGET_STATUS_INTERVAL_TICKS;
        }
    }

    private record LocalSnapshot(
            List<ItemStack> hotbar,
            ItemStack offhand,
            int selectedSlot,
            CameraType cameraType,
            boolean usingItem,
            InteractionHand useHand,
            float health,
            int foodLevel,
            float foodSaturation,
            float experienceProgress,
            int experienceLevel,
            int totalExperience
    ) {
        private static LocalSnapshot capture(LocalPlayer player, CameraType cameraType) {
            ArrayList<ItemStack> hotbar = new ArrayList<>(PlayerViewPayload.HOTBAR_SIZE);
            for (int index = 0; index < PlayerViewPayload.HOTBAR_SIZE; index++) {
                hotbar.add(player.getInventory().getItem(index).copy());
            }
            return new LocalSnapshot(
                    List.copyOf(hotbar),
                    player.getItemInHand(InteractionHand.OFF_HAND).copy(),
                    player.getInventory().getSelectedSlot(),
                    cameraType,
                    player.isUsingItem(),
                    player.getUsedItemHand(),
                    player.getHealth(),
                    player.getFoodData().getFoodLevel(),
                    player.getFoodData().getSaturationLevel(),
                    player.experienceProgress,
                    player.experienceLevel,
                    player.totalExperience);
        }

        private void restore(LocalPlayer player) {
            mirrorInventory(player.getInventory(), hotbar, selectedSlot);
            player.setItemInHand(InteractionHand.OFF_HAND, offhand.copy());
            player.setHealth(health);
            player.getFoodData().setFoodLevel(foodLevel);
            player.getFoodData().setSaturation(foodSaturation);
            player.experienceProgress = experienceProgress;
            player.experienceLevel = experienceLevel;
            player.totalExperience = totalExperience;
        }
    }
}
