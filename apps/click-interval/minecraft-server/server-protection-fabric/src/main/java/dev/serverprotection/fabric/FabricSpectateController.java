package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.SpectateRecoveryStore;
import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.network.protocol.game.ClientboundSetExperiencePacket;
import net.minecraft.network.protocol.game.ClientboundSetHealthPacket;
import net.minecraft.network.protocol.game.ClientboundSetHeldSlotPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.RecordComponent;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;

/** Privileged camera-only player POV sessions with crash-safe position recovery. */
final class FabricSpectateController {
    static final String ACTIVE_TAG = "server_pov_active";

    private static final double POSITION_EPSILON = 0.02;
    private static final float ROTATION_EPSILON = 0.1f;
    private static final long HEARTBEAT_TICKS = 20L;

    private final SpectateRecoveryStore store;
    private final Predicate<ServerPlayer> privileged;
    private final Logger logger;
    private final LinkedHashMap<UUID, SpectateRecoveryStore.Origin> sessions = new LinkedHashMap<>();
    private final Set<UUID> activeViewers = ConcurrentHashMap.newKeySet();
    private final LinkedHashMap<UUID, ViewSync> syncSessions = new LinkedHashMap<>();
    private final PlayerViewNegotiation negotiation = new PlayerViewNegotiation();
    private boolean journalHealthy;
    private MinecraftServer server;
    private long ticks;

    FabricSpectateController(Path file, Predicate<ServerPlayer> privileged, Logger logger) {
        store = new SpectateRecoveryStore(file);
        this.privileged = privileged;
        this.logger = logger;
    }

    void start(MinecraftServer minecraftServer) {
        server = minecraftServer;
        ticks = 0L;
        sessions.clear();
        activeViewers.clear();
        syncSessions.clear();
        negotiation.clear();
        try {
            // Entries loaded here are recovery records, not active camera sessions. onJoin restores them.
            sessions.putAll(store.load());
            journalHealthy = true;
        } catch (IOException error) {
            journalHealthy = false;
            logger.error("Player-view recovery could not be loaded; new camera sessions are disabled: {}",
                    error.getMessage());
        }
    }

    boolean canUse(ServerPlayer player) {
        return player != null && privileged.test(player);
    }

    boolean isViewing(ServerPlayer player) {
        return player != null && activeViewers.contains(player.getUUID());
    }

    Result begin(ServerPlayer viewer, ServerPlayer target) {
        if (!journalHealthy) return Result.fail("Player viewing is unavailable until its recovery file is repaired.");
        if (!canUse(viewer)) return Result.fail("Your assigned role does not allow player viewing.");
        // Never fall back to vanilla's camera path without the companion. ServerPlayer#setCamera
        // relocates the server-side player to keep remote chunks streamed; without the companion's
        // input lock and local POV mirror that becomes a controllable teleport instead of a view.
        if (!companionReady(viewer)) {
            return Result.fail("Player viewing requires the matching, up-to-date client companion mod.");
        }
        if (target == null || target.isRemoved()) return Result.fail("That player is not online.");
        if (viewer.getUUID().equals(target.getUUID())) return Result.fail("You cannot view yourself.");
        String unsafeState = PlayerViewStartGuard.rejection(
                viewer.isAlive(), viewer.isChangingDimension(), viewer.isSleeping(),
                viewer.isPassenger(), viewer.isVehicle(), viewer.isFallFlying(), viewer.isUsingItem(),
                viewer.containerMenu == viewer.inventoryMenu);
        if (!unsafeState.isEmpty()) return Result.fail(unsafeState);
        UUID viewerId = viewer.getUUID();
        SpectateRecoveryStore.Origin previous = sessions.get(viewerId);
        if (previous != null && !activeViewers.contains(viewerId)) {
            return Result.fail("A previous player-view recovery is pending. Use /ci-unspectate first.");
        }

        SpectateRecoveryStore.Origin updated;
        try {
            updated = previous == null ? capture(viewer, target) : previous.withTarget(
                    target.getUUID(), target.getGameProfile().name());
        } catch (IllegalArgumentException invalid) {
            return Result.fail("Your current location could not be saved safely.");
        }
        if (previous == null && sessions.size() >= SpectateRecoveryStore.MAX_RECORDS) {
            return Result.fail("Too many player-view sessions are already active.");
        }

        sessions.put(viewerId, updated);
        if (!persist()) {
            if (previous == null) sessions.remove(viewerId);
            else sessions.put(viewerId, previous);
            return Result.fail("Your return location could not be saved. Nothing was changed.");
        }

        try {
            stopSync(viewer);
            activeViewers.add(viewerId);
            viewer.addTag(ACTIVE_TAG);
            ViewSync sync = new ViewSync(UUID.randomUUID());
            syncSessions.put(viewerId, sync);
            // Queue START before vanilla's camera/position packets. This makes the companion lock
            // gameplay input before the internally relocated player can be controlled.
            if (!sendState(viewer, target, sync, true)) {
                throw new IllegalStateException("client companion unavailable");
            }
            viewer.setCamera(target);
            return Result.ok("Now viewing " + target.getGameProfile().name() + ". Use /ci-unspectate to return.");
        } catch (RuntimeException failed) {
            logger.warn("Could not start player view for {}: {}",
                    viewer.getGameProfile().name(), failed.getMessage());
            Result restored = restore(viewer);
            return Result.fail(restored.success()
                    ? "The camera could not follow that player. Your previous state was restored."
                    : "The camera failed and automatic recovery is still pending.");
        }
    }

    Result restore(ServerPlayer viewer) {
        if (viewer == null) return Result.fail("That player is not online.");
        UUID viewerId = viewer.getUUID();
        SpectateRecoveryStore.Origin origin = sessions.get(viewerId);
        if (origin == null) {
            deactivate(viewer);
            return Result.fail("You are not viewing another player.");
        }
        MinecraftServer minecraftServer = server;
        if (minecraftServer == null) return Result.fail("The server is not ready to restore your position.");
        ServerLevel level = resolveLevel(minecraftServer, origin.worldId());
        if (level == null) return Result.fail("Your saved world is not currently available.");
        try {
            viewer.setCamera(viewer);
            boolean teleported = viewer.teleportTo(level, origin.x(), origin.y(), origin.z(), Set.of(),
                    origin.yaw(), origin.pitch(), false);
            boolean gameModeRestored = PlayerViewOriginRestorer.restoreGameMode(viewer, origin.gameMode());
            if (!teleported || !gameModeRestored || !matches(viewer, level, origin)) {
                rebindAfterFailedRestore(viewer, origin);
                return Result.fail("Your saved state could not be verified; recovery remains pending.");
            }

            deactivate(viewer);
            sessions.remove(viewerId);
            if (!persist()) {
                // The player is already safely back. Keep only the journal record for retry/restart recovery.
                sessions.put(viewerId, origin);
                return Result.fail("You returned, but recovery cleanup is pending. Try /ci-unspectate again.");
            }
            return Result.ok("Returned to your previous location.");
        } catch (RuntimeException failed) {
            rebindAfterFailedRestore(viewer, origin);
            logger.warn("Could not restore player-view session for {}: {}", origin.viewerName(), failed.getMessage());
            return Result.fail("Your saved state could not be restored yet. Try /ci-unspectate again.");
        }
    }

    /** Maintains camera bindings and bounded HUD/hand snapshots even when protection checks are disabled. */
    void tick(MinecraftServer minecraftServer) {
        ticks++;
        if (minecraftServer == null || activeViewers.isEmpty()) return;

        for (UUID viewerId : new ArrayList<>(activeViewers)) {
            SpectateRecoveryStore.Origin origin = sessions.get(viewerId);
            ServerPlayer viewer = minecraftServer.getPlayerList().getPlayer(viewerId);
            if (origin == null) {
                if (viewer != null) deactivate(viewer);
                else {
                    activeViewers.remove(viewerId);
                    syncSessions.remove(viewerId);
                }
                continue;
            }
            if (viewer == null || viewer.isRemoved()) continue;
            if (!canUse(viewer)) {
                Result result = restore(viewer);
                viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                        "Your player-view access changed. " + result.message()));
                continue;
            }

            ServerPlayer target = minecraftServer.getPlayerList().getPlayer(origin.targetId());
            if (target == null) {
                Result result = restore(viewer);
                viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                        "The player you were viewing left. " + result.message()));
                continue;
            }
            // A respawn may briefly leave the old target entity removed. Keep the recovery session and
            // bind to the replacement instance on the next tick instead of ending the view.
            if (target.isRemoved()) continue;

            try {
                // Revalidate the negotiated channel before any camera rebind can move the
                // server-side viewer. A lost/stale companion must restore in place, fail closed,
                // and never receive even one tick of unguarded camera relocation.
                if (!companionReady(viewer)) {
                    Result result = restore(viewer);
                    viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                            "The client companion became unavailable. " + result.message()));
                    continue;
                }
                viewer.addTag(ACTIVE_TAG);
                boolean dimensionChanged = viewer.level() != target.level();
                boolean rebound = viewer.getCamera() != target
                        || dimensionChanged;
                if (rebound) {
                    // setCamera is a no-op when the same target object changed dimensions, so detach
                    // first in that specific case to force the cross-world teleport and camera packet.
                    if (dimensionChanged && viewer.getCamera() == target) viewer.setCamera(viewer);
                    viewer.setCamera(target);
                }
                ViewSync sync = syncSessions.computeIfAbsent(viewerId, ignored -> new ViewSync(UUID.randomUUID()));
                rebound = rebound || sync.targetEntityId != target.getId();
                if (!sendState(viewer, target, sync, rebound)) {
                    throw new IllegalStateException("client companion unavailable");
                }
            } catch (RuntimeException error) {
                logger.warn("Player view tick failed for {}: {}",
                        viewer.getGameProfile().name(), error.getMessage());
                Result result = restore(viewer);
                viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                        "Player viewing stopped after a camera error. " + result.message()));
            }
        }
    }

    void onJoin(ServerPlayer player) {
        if (!sessions.containsKey(player.getUUID())) {
            // A hard crash can persist the scoreboard marker separately from the recovery journal.
            // Never let a stale marker make the desktop app report a session that does not exist.
            player.removeTag(ACTIVE_TAG);
            return;
        }
        Result result = restore(player);
        player.sendSystemMessage(net.minecraft.network.chat.Component.literal(result.message()));
    }

    void onReady(ServerPlayer player, PlayerViewReadyPayload readiness) {
        if (player != null && readiness != null) negotiation.announce(player.getUUID(), readiness);
    }

    void onDisconnect(ServerPlayer player) {
        if (sessions.containsKey(player.getUUID())) restore(player);
        restoreViewersOf(player.getUUID(), "The player you were viewing left. ");
        negotiation.remove(player.getUUID());
    }

    void restoreUnauthorized(MinecraftServer server) {
        if (server == null) return;
        for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
            ServerPlayer viewer = server.getPlayerList().getPlayer(origin.viewerId());
            if (viewer == null || canUse(viewer)) continue;
            Result result = restore(viewer);
            viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                    "Your player-view access changed. " + result.message()));
        }
    }

    void shutdown(MinecraftServer server) {
        if (server != null) {
            for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
                ServerPlayer viewer = server.getPlayerList().getPlayer(origin.viewerId());
                if (viewer != null) restore(viewer);
            }
        }
        persist();
        sessions.clear();
        activeViewers.clear();
        syncSessions.clear();
        negotiation.clear();
        this.server = null;
    }

    int activeSessions() {
        return activeViewers.size();
    }

    private void restoreViewersOf(UUID targetId, String prefix) {
        MinecraftServer minecraftServer = server;
        if (minecraftServer == null) return;
        for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
            if (!origin.targetId().equals(targetId)) continue;
            ServerPlayer viewer = minecraftServer.getPlayerList().getPlayer(origin.viewerId());
            if (viewer == null) continue;
            Result result = restore(viewer);
            viewer.sendSystemMessage(net.minecraft.network.chat.Component.literal(prefix + result.message()));
        }
    }

    private void rebindAfterFailedRestore(ServerPlayer viewer, SpectateRecoveryStore.Origin origin) {
        if (!activeViewers.contains(viewer.getUUID()) || server == null) return;
        ServerPlayer target = server.getPlayerList().getPlayer(origin.targetId());
        if (target == null || target.isRemoved()) return;
        try {
            viewer.setCamera(target);
        } catch (RuntimeException ignored) {
            // The durable recovery record remains available for /ci-unspectate or the next login.
        }
    }

    private void deactivate(ServerPlayer viewer) {
        if (viewer == null) return;
        stopSync(viewer);
        activeViewers.remove(viewer.getUUID());
        viewer.removeTag(ACTIVE_TAG);
        resyncViewerState(viewer);
    }

    private void resyncViewerState(ServerPlayer viewer) {
        try {
            viewer.inventoryMenu.sendAllDataToRemote();
            if (viewer.containerMenu != viewer.inventoryMenu) viewer.containerMenu.sendAllDataToRemote();
            viewer.connection.send(new ClientboundSetHeldSlotPacket(viewer.getInventory().getSelectedSlot()));
            viewer.connection.send(new ClientboundSetHealthPacket(
                    viewer.getHealth(), viewer.getFoodData().getFoodLevel(),
                    viewer.getFoodData().getSaturationLevel()));
            viewer.connection.send(new ClientboundSetExperiencePacket(
                    viewer.experienceProgress, viewer.totalExperience, viewer.experienceLevel));
        } catch (RuntimeException error) {
            logger.debug("Could not finish player-view state resync for {}: {}",
                    viewer.getGameProfile().name(), error.getMessage());
        }
    }

    private void stopSync(ServerPlayer viewer) {
        ViewSync sync = syncSessions.remove(viewer.getUUID());
        if (sync == null || !ServerPlayNetworking.canSend(viewer, PlayerViewPayload.TYPE)) return;
        try {
            ServerPlayNetworking.send(viewer, PlayerViewPayload.stop(sync.sessionId, sync.nextSequence()));
        } catch (RuntimeException error) {
            logger.debug("Could not send player-view stop to {}: {}",
                    viewer.getGameProfile().name(), error.getMessage());
        }
    }

    private boolean sendState(ServerPlayer viewer, ServerPlayer target, ViewSync sync, boolean start) {
        if (!companionReady(viewer)) return false;

        ArrayList<ItemStack> inventory = new ArrayList<>(PlayerViewPayload.INVENTORY_SIZE);
        List<ItemStack> nonEquipment = target.getInventory().getNonEquipmentItems();
        for (int slot = 0; slot < PlayerViewPayload.INVENTORY_SIZE; slot++) {
            inventory.add(slot < nonEquipment.size() ? nonEquipment.get(slot) : ItemStack.EMPTY);
        }
        List<ItemStack> armor = List.of(
                target.getItemBySlot(EquipmentSlot.HEAD),
                target.getItemBySlot(EquipmentSlot.CHEST),
                target.getItemBySlot(EquipmentSlot.LEGS),
                target.getItemBySlot(EquipmentSlot.FEET));
        ItemStack offhand = target.getOffhandItem();
        int selectedSlot = Math.max(0, Math.min(PlayerViewPayload.HOTBAR_SIZE - 1,
                target.getInventory().getSelectedSlot()));
        int food = Math.max(0, Math.min(20, target.getFoodData().getFoodLevel()));
        float health = finiteClamp(target.getHealth(), 0.0F, 1_000_000.0F);
        float saturation = finiteClamp(target.getFoodData().getSaturationLevel(), 0.0F, 40.0F);
        float experienceProgress = finiteClamp(target.experienceProgress, 0.0F, 1.0F);
        int experienceLevel = Math.max(0, Math.min(50_000_000, target.experienceLevel));
        int totalExperience = Math.max(0, Math.min(50_000_000, target.totalExperience));
        SwingState swing = SwingReader.INSTANCE.read(target);
        boolean swinging = swing.swinging();
        InteractionHand swingHand = swing.hand();
        boolean usingItem = target.isUsingItem();
        InteractionHand useHand = usingItem ? target.getUsedItemHand() : InteractionHand.MAIN_HAND;

        long fingerprint = fingerprint(target, inventory, armor, offhand, selectedSlot, food, saturation,
                experienceProgress, experienceLevel, totalExperience, swinging, swingHand, usingItem, useHand);
        if (!start && fingerprint == sync.lastFingerprint && ticks - sync.lastSentTick < HEARTBEAT_TICKS) {
            return true;
        }

        PlayerViewPayload payload = start
                ? PlayerViewPayload.start(sync.sessionId, sync.nextSequence(), target.getId(), target.getUUID(),
                        target.getGameProfile().name(), inventory, armor, offhand, selectedSlot, health, food, saturation,
                        experienceProgress, experienceLevel, totalExperience,
                        swinging, swingHand, usingItem, useHand)
                : PlayerViewPayload.snapshot(sync.sessionId, sync.nextSequence(), target.getId(), target.getUUID(),
                        target.getGameProfile().name(), inventory, armor, offhand, selectedSlot, health, food, saturation,
                        experienceProgress, experienceLevel, totalExperience,
                        swinging, swingHand, usingItem, useHand);
        ServerPlayNetworking.send(viewer, payload);
        sync.targetEntityId = target.getId();
        sync.lastFingerprint = fingerprint;
        sync.lastSentTick = ticks;
        return true;
    }

    private boolean companionReady(ServerPlayer viewer) {
        return viewer != null
                && negotiation.supports(viewer.getUUID(), PlayerViewPayload.PROTOCOL_VERSION)
                && ServerPlayNetworking.canSend(viewer, PlayerViewPayload.TYPE);
    }

    private static long fingerprint(ServerPlayer target, List<ItemStack> inventory, List<ItemStack> armor,
                                    ItemStack offhand,
                                    int selectedSlot, int food, float saturation,
                                    float experienceProgress, int experienceLevel, int totalExperience,
                                    boolean swinging, InteractionHand swingHand,
                                    boolean usingItem, InteractionHand useHand) {
        long value = target.getUUID().getMostSignificantBits() ^ target.getUUID().getLeastSignificantBits();
        value = value * 31L + target.getId();
        value = value * 31L + ItemStack.hashStackList(inventory);
        for (ItemStack stack : inventory) value = value * 31L + stack.getCount();
        value = value * 31L + ItemStack.hashStackList(armor);
        for (ItemStack stack : armor) value = value * 31L + stack.getCount();
        value = value * 31L + ItemStack.hashItemAndComponents(offhand);
        value = value * 31L + offhand.getCount();
        value = value * 31L + selectedSlot;
        value = value * 31L + Float.floatToIntBits(target.getHealth());
        value = value * 31L + food;
        value = value * 31L + Float.floatToIntBits(saturation);
        value = value * 31L + Float.floatToIntBits(experienceProgress);
        value = value * 31L + experienceLevel;
        value = value * 31L + totalExperience;
        value = value * 31L + (swinging ? 1 : 0);
        value = value * 31L + swingHand.ordinal();
        value = value * 31L + (usingItem ? 1 : 0);
        return value * 31L + useHand.ordinal();
    }

    private static float finiteClamp(float value, float minimum, float maximum) {
        return Float.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
    }

    private SpectateRecoveryStore.Origin capture(ServerPlayer viewer, ServerPlayer target) {
        return new SpectateRecoveryStore.Origin(
                viewer.getUUID(), viewer.getGameProfile().name(),
                target.getUUID(), target.getGameProfile().name(),
                viewer.level().dimension().identifier().toString(),
                viewer.getX(), viewer.getY(), viewer.getZ(), viewer.getYRot(), viewer.getXRot(),
                viewer.gameMode().getName());
    }

    private ServerLevel resolveLevel(MinecraftServer server, String value) {
        try {
            Identifier identifier = Identifier.tryParse(value);
            if (identifier == null) return null;
            return server.getLevel(ResourceKey.create(Registries.DIMENSION, identifier));
        } catch (RuntimeException invalid) {
            return null;
        }
    }

    private boolean persist() {
        if (!journalHealthy) return false;
        try {
            store.save(sessions.values());
            return true;
        } catch (IOException error) {
            logger.error("Player-view recovery could not be saved: {}", error.getMessage());
            return false;
        }
    }

    private static boolean matches(ServerPlayer viewer, ServerLevel level,
                                   SpectateRecoveryStore.Origin origin) {
        return viewer.level() == level
                && Math.abs(viewer.getX() - origin.x()) <= POSITION_EPSILON
                && Math.abs(viewer.getY() - origin.y()) <= POSITION_EPSILON
                && Math.abs(viewer.getZ() - origin.z()) <= POSITION_EPSILON
                && angularDistance(viewer.getYRot(), origin.yaw()) <= ROTATION_EPSILON
                && Math.abs(viewer.getXRot() - origin.pitch()) <= ROTATION_EPSILON
                && PlayerViewOriginRestorer.matchesGameMode(viewer, origin.gameMode());
    }

    private static float angularDistance(float first, float second) {
        float delta = Math.abs((first - second) % 360.0f);
        return Math.min(delta, 360.0f - delta);
    }

    private static final class ViewSync {
        private final UUID sessionId;
        private int sequence;
        private int targetEntityId = -1;
        private long lastFingerprint = Long.MIN_VALUE;
        private long lastSentTick = Long.MIN_VALUE;

        private ViewSync(UUID sessionId) {
            this.sessionId = sessionId;
        }

        private int nextSequence() {
            if (sequence == Integer.MAX_VALUE) sequence = 0;
            return sequence++;
        }
    }

    /**
     * Minecraft 26.2 stores swing state in public fields while 26.3 replaced those fields with a
     * SwingDescription record. This structural adapter is discovered once, avoids mapped-name
     * assumptions at runtime, and costs only two field reads or one method call per emitted sample.
     */
    private interface SwingReader {
        SwingReader INSTANCE = discover();

        SwingState read(LivingEntity entity);

        static SwingReader discover() {
            Field activeField = null;
            Field handField = null;
            for (Field field : LivingEntity.class.getDeclaredFields()) {
                int modifiers = field.getModifiers();
                if (!Modifier.isPublic(modifiers) || Modifier.isStatic(modifiers)) continue;
                if (field.getType() == boolean.class && activeField == null) activeField = field;
                if (field.getType() == InteractionHand.class && handField == null) handField = field;
            }
            if (activeField != null && handField != null) {
                Field active = activeField;
                Field hand = handField;
                return entity -> {
                    try {
                        boolean swinging = active.getBoolean(entity);
                        InteractionHand value = (InteractionHand) hand.get(entity);
                        return new SwingState(swinging,
                                value == null ? InteractionHand.MAIN_HAND : value);
                    } catch (IllegalAccessException | RuntimeException ignored) {
                        return SwingState.NONE;
                    }
                };
            }

            for (Method method : LivingEntity.class.getMethods()) {
                if (method.getParameterCount() != 0 || !method.getReturnType().isRecord()) continue;
                Method handAccessor = null;
                for (RecordComponent component : method.getReturnType().getRecordComponents()) {
                    if (component.getType() == InteractionHand.class) {
                        handAccessor = component.getAccessor();
                        break;
                    }
                }
                if (handAccessor == null) continue;
                Method currentSwing = method;
                Method currentHand = handAccessor;
                return entity -> {
                    try {
                        Object description = currentSwing.invoke(entity);
                        if (description == null) return SwingState.NONE;
                        InteractionHand value = (InteractionHand) currentHand.invoke(description);
                        return new SwingState(true,
                                value == null ? InteractionHand.MAIN_HAND : value);
                    } catch (ReflectiveOperationException | RuntimeException ignored) {
                        return SwingState.NONE;
                    }
                };
            }
            return entity -> SwingState.NONE;
        }
    }

    private record SwingState(boolean swinging, InteractionHand hand) {
        private static final SwingState NONE = new SwingState(false, InteractionHand.MAIN_HAND);
    }

    record Result(boolean success, String message) {
        static Result ok(String message) { return new Result(true, message); }
        static Result fail(String message) { return new Result(false, message); }
    }
}
