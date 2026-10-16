package com.clickinterval.endlock;

import com.mojang.authlib.GameProfile;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.NetherPortalBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.portal.PortalShape;
import net.minecraft.world.level.portal.TeleportTransition;
import net.minecraft.world.level.storage.LevelData;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import static com.clickinterval.endlock.EndLockState.Domain.END;
import static com.clickinterval.endlock.EndLockState.Domain.NETHER;

/** Only invoked inside the explicitly marked disposable native fixture. */
final class DimensionLockSelfTest {
    static void run(MinecraftServer server) {
        EndLockState state = ServerEndLock.state(server);
        boolean endBefore = state.locked(), netherBefore = state.locked(NETHER);
        ServerLevel overworld = server.overworld(), nether = server.getLevel(Level.NETHER);
        var spawnBefore = overworld.getRespawnData();
        Map<ServerLevel, Map<BlockPos, BlockState>> changed = new LinkedHashMap<>();
        NativePlayer player = new NativePlayer(server, overworld, "NetherLockTest");
        NativePlayer unknown = new NativePlayer(server, nether, "UnknownOrigin");
        NativePlayer legacy = new NativePlayer(server, nether, "VanillaOrigin");
        try {
            require(nether != null, "Nether dimension exists");
            safePad(overworld, changed);
            safePad(nether, changed);
            overworld.setRespawnData(LevelData.RespawnData.of(Level.OVERWORLD, new BlockPos(90, 97, 70), 0, 0));
            player.setPos(90.5, 97, 70.5);
            attach(server, player);
            state.setLocked(END, true);
            state.setEyeCraftingBlocked(false);
            require(!ServerEndLock.blocksEyes(overworld) && ServerEndLock.locked(overworld), "eye toggle is independent of End entry lock");
            state.setEyeCraftingBlocked(true);
            state.setFrameInsertionBlocked(false);
            require(!ServerEndLock.blocksFrames(overworld) && ServerEndLock.locked(overworld), "frame toggle is independent of End entry lock");
            state.setFrameInsertionBlocked(true);
            var dispatcher = server.getCommands().getDispatcher();
            dispatcher.execute("netherlock for 2d", server.createCommandSourceStack());
            require(state.locked(NETHER) && state.remaining(NETHER) > DurationSpec.parseMillis("1d"), "native console timer command persists two days");
            require(state.locked(), "Nether timer leaves End state unchanged");
            require(!dispatcher.getRoot().getChild("netherlock").canUse(player.createCommandSourceStack().withPermission(LevelBasedPermissionSet.OWNER)), "dedicated operator cannot run Nether admin command");
            require(ServerEndLock.blocksEntry(player, nether), "locked incoming Nether entry denied");
            require(!player.teleportTo(nether, 90.5, 97, 70.5, Set.of(), 0, 0, false), "command teleport cannot bypass Nether lock");
            require(!new NetherOriginStore(server.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/nether-origins")).read(player.getUUID()).isPresent(), "denied entry never records a successful origin");
            portal(overworld, player, state, changed);
            state.setLocked(NETHER, false);
            Vec3 origin = player.position();
            require(player.teleport(new TeleportTransition(nether, new Vec3(90.5, 97, 70.5), Vec3.ZERO, 0, 0,
                    TeleportTransition.DO_NOTHING)) != null && player.level() == nether, "unlocked native dimension travel succeeds");
            var saved = new NetherOriginStore(server.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/nether-origins")).read(player.getUUID()).orElseThrow();
            require(saved.x() == origin.x && saved.y() == origin.y && saved.z() == origin.z
                    && saved.dimension().equals("minecraft:overworld"), "successful entry persists precise pre-move origin");
            dispatcher.execute("netherlock on", server.createCommandSourceStack());
            require(!ServerEndLock.blocksEntry(player, overworld), "Nether exit remains allowed while locked");
            require(!ServerEndLock.blocksEntry(player, nether), "movement already within Nether is not treated as new entry");
            ServerEndLock.runtime(server).tick(server);
            require(player.level() == overworld && player.position().distanceTo(origin) < 0.01, "bounded tick evacuates already-Nether player to verified prior origin");
            require(player.messages.stream().anyMatch(text -> text.contains("prior Nether entry")), "evacuation reports known-origin destination");
            unknown.setPos(90.5, 97, 70.5);
            attach(server, unknown);
            ServerEndLock.runtime(server).joined(unknown);
            require(ServerEndLock.runtime(server).evacuate(server, unknown, System.currentTimeMillis()), "joined unknown-origin Nether player evacuates safely");
            require(unknown.level() == overworld && EvacuationSafety.safe(overworld, unknown, unknown.position()), "unknown origin uses verified real Overworld spawn");
            require(unknown.messages.stream().anyMatch(text -> text.contains("prior entry unknown")), "unknown history is explicitly disclosed");
            var legacyField = ServerPlayer.class.getDeclaredField("enteredNetherPosition");
            legacyField.setAccessible(true);
            Vec3 legacyOrigin = new Vec3(91.5, 97, 71.5);
            legacyField.set(legacy, legacyOrigin);
            legacy.setPos(90.5, 97, 70.5);
            attach(server, legacy);
            float healthBefore = legacy.getHealth();
            require(ServerEndLock.protectedDuringEvacuation(legacy), "locked-Nether legacy login is protected before first evacuation tick");
            require(!legacy.hurtServer(nether, legacy.damageSources().lava(), 1000)
                    && !legacy.hurtServer(nether, legacy.damageSources().fellOutOfWorld(), 1000)
                    && legacy.getHealth() == healthBefore, "lava and void cannot kill a player awaiting safe return");
            require(ServerEndLock.runtime(server).evacuate(server, legacy, System.currentTimeMillis()), "vanilla pre-installation origin evacuates safely");
            require(legacy.level() == overworld && legacy.position().distanceTo(legacyOrigin) < 0.01,
                    "legacy player returns to exact vanilla saved Overworld portal position without guessed scaling");
            require(ServerEndLock.protectedDuringEvacuation(legacy)
                    && !legacy.hurtServer(overworld, legacy.damageSources().fall(), 1000), "brief arrival grace protects against transfer damage");
            require(!EvacuationSafety.safe(overworld, player, new Vec3(29_000_000.5, 97, 29_000_000.5)), "unloaded arbitrary distant origin is refused without loading");
            BlockPos floor = new BlockPos(90, 96, 70);
            var ordinaryFloor = overworld.getBlockState(floor);
            overworld.setBlock(floor, Blocks.MAGMA_BLOCK.defaultBlockState(), 3);
            require(!EvacuationSafety.safe(overworld, player, new Vec3(90.5, 97, 70.5)), "hazardous return floor rejected");
            overworld.setBlock(floor, ordinaryFloor, 3);
            state.lockFor(NETHER, 1000, System.currentTimeMillis() - 2000);
            new LockRuntime(server.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/nether-origins")).tick(server);
            require(!state.locked(NETHER) && state.locked(), "tick timer expiry unlocks only Nether");
            require(!new EndLockState(server.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/state.properties")).locked(NETHER), "automatic expiry persists across restart");
            dispatcher.execute("endlock for 1d", server.createCommandSourceStack());
            require(state.locked() && !state.locked(NETHER), "End timer remains independent");
            require(ServerEndLock.lockMessage(state, END, System.currentTimeMillis()).startsWith("End opens in "), "countdown message uses real remaining deadline");
            long launch = System.currentTimeMillis();
            state.armForNextLaunch(DurationSpec.parseMillis("2d"), DurationSpec.parseMillis("3d"));
            require(state.unlockAtMillis(NETHER) == 0 && state.startOnLaunchMillis(NETHER) == DurationSpec.parseMillis("2d"), "offline-armed timer has not started early");
            require(state.startPendingTimers(launch), "native launch starts both armed timers together");
            require(state.unlockAtMillis(NETHER) == launch + 172800000L && state.unlockAtMillis(END) == launch + 259200000L,
                    "native opening deadlines are exact48h Nether and72h End");
            require(ServerEndLock.lockMessage(state, NETHER, launch).contains("closed for the first 2 real days")
                    && ServerEndLock.lockMessage(state, END, launch).contains("closed for the first 3 real days"), "opening-period notices include correct real-day durations");
            require(!new EndLockState(server.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/state.properties"), () -> launch + 1000)
                    .startPendingTimers(launch + 1000), "native reload never restarts an activated launch timer");
            ServerEndLock.LOGGER.info("SERVER_OPENING_PERIOD_NATIVE_TEST_PASS: pending-to-absolute48h72h, restart persistence, vanilla portal origin recovery, lava/void waiting immunity and arrival grace.");
            ServerEndLock.LOGGER.info("SERVER_DIMENSION_LOCK_NATIVE_TEST_PASS: independent timers, commands, ignition, portal transit, exact origins, bounded evacuation, safe fallback, hazards and expiry persistence.");
        } catch (Exception failure) { throw new IllegalStateException("Dimension lock native selftest failed", failure); }
        finally {
            detach(server, player); detach(server, unknown); detach(server, legacy);
            overworld.setRespawnData(spawnBefore);
            changed.forEach((level, blocks) -> blocks.forEach((pos, before) -> level.setBlock(pos, before, 3)));
            try { state.setLocked(END, endBefore); state.setLocked(NETHER, netherBefore); state.setEyeCraftingBlocked(true); state.setFrameInsertionBlocked(true); }
            catch (java.io.IOException failure) { throw new IllegalStateException("Could not restore fixture locks", failure); }
        }
    }

    private static void portal(ServerLevel level, NativePlayer player, EndLockState state,
                               Map<ServerLevel, Map<BlockPos, BlockState>> changed) throws java.io.IOException {
        for (int x = 72; x <= 75; x++) for (int y = 96; y <= 100; y++) {
            set(level, new BlockPos(x, y, 72), x == 72 || x == 75 || y == 96 || y == 100 ? Blocks.OBSIDIAN.defaultBlockState() : Blocks.AIR.defaultBlockState(), changed);
        }
        BlockPos interior = new BlockPos(73, 97, 72);
        var shape = PortalShape.findEmptyPortalShape(level, interior, Direction.Axis.X).orElseThrow();
        shape.createPortalBlocks(level);
        require(!level.getBlockState(interior).is(Blocks.NETHER_PORTAL), "locked direct portal ignition is cancelled");
        player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(Items.FLINT_AND_STEEL));
        BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(interior.below()), Direction.UP, interior.below(), false);
        require(UseBlockCallback.EVENT.invoker().interact(player, level, InteractionHand.MAIN_HAND, hit) == InteractionResult.FAIL,
                "player portal ignition denied before consuming flint durability");
        state.setLocked(NETHER, false);
        Items.FLINT_AND_STEEL.useOn(new UseOnContext(player, InteractionHand.MAIN_HAND, hit));
        require(level.getBlockState(interior).is(Blocks.NETHER_PORTAL), "unlock restores actual flint-and-steel portal creation");
        state.setLocked(NETHER, true);
        require(((NetherPortalBlock) Blocks.NETHER_PORTAL).getPortalDestination(level, player, interior) == null,
                "existing portal cannot create destination or bypass lock");
    }

    private static void safePad(ServerLevel level, Map<ServerLevel, Map<BlockPos, BlockState>> changed) {
        for (int x = 88; x <= 92; x++) for (int z = 68; z <= 72; z++) for (int y = 96; y <= 99; y++) {
            set(level, new BlockPos(x, y, z), y == 96 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState(), changed);
        }
    }
    private static void set(ServerLevel level, BlockPos pos, BlockState block, Map<ServerLevel, Map<BlockPos, BlockState>> changed) {
        level.getChunk(pos); // Explicit disposable native fixture only, never production evacuation.
        changed.computeIfAbsent(level, ignored -> new LinkedHashMap<>()).putIfAbsent(pos, level.getBlockState(pos));
        level.setBlock(pos, block, 3);
    }
    private static void attach(MinecraftServer server, ServerPlayer player) {
        server.getPlayerList().getPlayersByUUID().put(player.getUUID(), player);
        server.getPlayerList().getPlayers().add(player);
        player.level().addNewPlayer(player);
    }
    private static void detach(MinecraftServer server, ServerPlayer player) {
        if (server.getPlayerList().getPlayers().contains(player)) {
            player.level().removePlayerImmediately(player, Entity.RemovalReason.DISCARDED);
            server.getPlayerList().getPlayersByUUID().remove(player.getUUID());
            server.getPlayerList().getPlayers().remove(player);
        }
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
        ServerEndLock.LOGGER.info("DIMENSION_LOCK_TEST: {}", message);
    }
    private static final class NativePlayer extends ServerPlayer {
        private final ArrayList<String> messages = new ArrayList<>();
        NativePlayer(MinecraftServer server, ServerLevel level, String name) {
            super(server, level, new GameProfile(UUID.randomUUID(), name), ClientInformation.createDefault());
            connection = new ServerGamePacketListenerImpl(server, new net.minecraft.network.Connection(PacketFlow.SERVERBOUND), this,
                    CommonListenerCookie.createInitial(getGameProfile(), false)) {
                @Override public void send(Packet<?> packet) { }
            };
        }
        @Override public boolean hasDisconnected() { return false; }
        @Override public void sendSystemMessage(Component text) { messages.add(text.getString()); }
        @Override public void sendSystemMessage(Component text, boolean overlay) { messages.add(text.getString()); }
    }
}
