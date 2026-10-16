package dev.serverdeathloot.fabric;

import dev.serverdeathloot.fabric.core.ChestPlacementPlan;
import dev.serverdeathloot.fabric.core.DeathLootConfig;
import dev.serverdeathloot.fabric.core.DeathLootMode;
import dev.serverdeathloot.fabric.core.ExpiryPolicy;
import dev.serverdeathloot.fabric.core.GridPos;
import dev.serverdeathloot.fabric.core.HorizontalStep;
import dev.serverdeathloot.fabric.core.PlacementPlanner;
import dev.serverdeathloot.fabric.core.StackCompactor;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.SectionPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.ChestType;
import net.minecraft.world.phys.shapes.CollisionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Server-only death loot controller. All world and inventory mutation runs synchronously on the
 * Minecraft server thread. No polling thread, network listener, chunk force-load, or global item
 * scan is used.
 */
public final class ServerDeathLootFabric implements ModInitializer {
    public static final String MOD_ID = "serverdeathloot_fabric";
    private static final String VERSION = "1.0.0";
    private static final int CHEST_SLOTS = 27;
    private static final int DOUBLE_CHEST_SLOTS = CHEST_SLOTS * 2;
    private static final int EXPIRY_SWEEP_TICKS = 20;
    private static final int BLOCK_FLAGS = Block.UPDATE_CLIENTS | Block.UPDATE_SUPPRESS_DROPS;
    private static final int REMOVE_BLOCK_FLAGS = Block.UPDATE_ALL | Block.UPDATE_SUPPRESS_DROPS;
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private static volatile ServerDeathLootFabric instance;

    private final Path configFile = FabricLoader.getInstance().getConfigDir()
            .resolve("server-death-loot")
            .resolve("config.properties");
    private final Map<ChestKey, TrackedChest> loadedExpiringChests = new HashMap<>();

    private DeathLootConfig config = DeathLootConfig.defaults();
    private MinecraftServer activeServer;
    private int ticksUntilExpirySweep = EXPIRY_SWEEP_TICKS;

    @Override
    public void onInitialize() {
        instance = this;
        ServerLifecycleEvents.SERVER_STARTING.register(this::onServerStarting);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
        ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.register(this::onBlockEntityLoad);
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.register(this::onBlockEntityUnload);
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                dispatcher.register(net.minecraft.commands.Commands.literal("serverdeathloot")
                        .requires(source -> source.permissions().hasPermission(Permissions.COMMANDS_ADMIN))
                        .executes(context -> sendStatus(context.getSource()))
                        .then(net.minecraft.commands.Commands.literal("status")
                                .executes(context -> sendStatus(context.getSource())))
                        .then(net.minecraft.commands.Commands.literal("reload")
                                .executes(context -> reload(context.getSource())))));
    }

    /** Called only by the Player.dropEquipment redirect at vanilla's death-inventory drop site. */
    public static boolean handleDeathInventory(ServerPlayer player, Inventory inventory) {
        ServerDeathLootFabric current = instance;
        return current != null && current.handleDeathInventoryInternal(player, inventory);
    }

    private void onServerStarting(MinecraftServer server) {
        activeServer = server;
        ticksUntilExpirySweep = EXPIRY_SWEEP_TICKS;
        loadedExpiringChests.clear();
        loadConfig(false);
        LOGGER.info(
                "Server Death Loot {} loaded for Fabric 26.2: mode={}, death drop lifetime={}s, death chest lifetime={}s, torches={}.",
                VERSION,
                config.mode().configValue(),
                config.deathDropLifetimeSeconds(),
                config.deathChestLifetimeSeconds(),
                config.placeTorches());
    }

    private void onServerStopping(MinecraftServer server) {
        if (activeServer == server) {
            activeServer = null;
            loadedExpiringChests.clear();
        }
    }

    private void onServerTick(MinecraftServer server) {
        if (server != activeServer || --ticksUntilExpirySweep > 0) return;
        ticksUntilExpirySweep = EXPIRY_SWEEP_TICKS;
        expireLoadedChests(server, System.currentTimeMillis());
    }

    private void onBlockEntityLoad(BlockEntity blockEntity, ServerLevel level) {
        trackIfExpiringChest(blockEntity, level);
    }

    private void onBlockEntityUnload(BlockEntity blockEntity, ServerLevel level) {
        if (!(blockEntity instanceof ChestBlockEntity)) return;
        loadedExpiringChests.remove(ChestKey.of(level, blockEntity.getBlockPos()));
    }

    private boolean handleDeathInventoryInternal(ServerPlayer player, Inventory inventory) {
        MinecraftServer server = activeServer;
        DeathLootConfig currentConfig = config;
        if (server == null || player.level().getServer() != server || currentConfig.mode() == DeathLootMode.VANILLA) {
            return false;
        }

        List<CapturedStack> captured;
        try {
            captured = removeInventory(inventory);
        } catch (InventoryCaptureException error) {
            LOGGER.error("Could not capture the death inventory for {}; vanilla handling will continue.",
                    player.getGameProfile().name(), error.getCause());
            return false;
        }
        if (captured.isEmpty()) return true;
        List<ItemStack> removed = captured.stream().map(CapturedStack::stack).toList();

        try {
            if (currentConfig.mode() == DeathLootMode.TIMED) {
                spawnTimedDrops(player, removed, currentConfig.deathDropLifetimeSeconds());
                return true;
            }

            List<ItemStack> compacted = compactStacks(removed);
            if (compacted.size() > DOUBLE_CHEST_SLOTS) {
                LOGGER.warn(
                        "Death inventory for {} needed {} chest slots; safely falling back to timed drops.",
                        player.getGameProfile().name(),
                        compacted.size());
                spawnTimedDrops(player, compacted, currentConfig.deathDropLifetimeSeconds());
                safelyNotifyFallback(player);
                return true;
            }

            ChestResult chestResult = createDeathChest(player, compacted, currentConfig);
            if (chestResult == null) {
                spawnTimedDrops(player, compacted, currentConfig.deathDropLifetimeSeconds());
                safelyNotifyFallback(player);
            } else {
                safelyNotifyChest(player, chestResult, currentConfig.deathChestLifetimeSeconds());
            }
        } catch (Throwable error) {
            // Inventory has already been detached from the player. The only safe recovery is to
            // materialize those exact stacks once, never to invoke vanilla dropAll a second time.
            LOGGER.error("Death loot handling failed for {}; dropping the captured inventory safely.",
                    player.getGameProfile().name(), error);
            spawnTimedDrops(player, removed, currentConfig.deathDropLifetimeSeconds());
            safelyNotifyFallback(player);
        }
        return true;
    }

    private List<CapturedStack> removeInventory(Inventory inventory) {
        List<CapturedStack> removed = new ArrayList<>(inventory.getContainerSize());
        try {
            for (int slot = 0; slot < inventory.getContainerSize(); slot++) {
                ItemStack stack = inventory.removeItemNoUpdate(slot);
                if (!stack.isEmpty()) removed.add(new CapturedStack(slot, stack));
            }
            inventory.setChanged();
            return removed;
        } catch (Throwable error) {
            for (CapturedStack captured : removed) {
                try {
                    inventory.setItem(captured.slot(), captured.stack());
                } catch (Throwable restoreError) {
                    error.addSuppressed(restoreError);
                }
            }
            inventory.setChanged();
            throw new InventoryCaptureException(error);
        }
    }

    private List<ItemStack> compactStacks(List<ItemStack> stacks) {
        return StackCompactor.compact(
                stacks,
                ItemStack::getCount,
                ItemStack::getMaxStackSize,
                ItemStack::isSameItemSameComponents,
                ItemStack::copy,
                ItemStack::setCount);
    }

    private void spawnTimedDrops(ServerPlayer player, List<ItemStack> stacks, int lifetimeSeconds) {
        long expiresAt = ExpiryPolicy.deadlineMillis(System.currentTimeMillis(), lifetimeSeconds);
        for (ItemStack stack : stacks) {
            if (stack == null || stack.isEmpty()) continue;
            try {
                ItemEntity itemEntity = player.drop(stack, true, false);
                if (itemEntity == null) {
                    LOGGER.error("Minecraft could not create a death-drop entity for {} x{} from {}.",
                            stack.getItem(), stack.getCount(), player.getGameProfile().name());
                    continue;
                }
                try {
                    ((DeathDropMarker) (Object) itemEntity).serverDeathLoot$setExpiry(expiresAt);
                } catch (Throwable markerError) {
                    // The entity already exists in the world. Leave its vanilla lifetime intact;
                    // retrying the stack would duplicate it.
                    LOGGER.error("A death drop for {} was created but its custom lifetime could not be attached; it will use vanilla lifetime.",
                            player.getGameProfile().name(), markerError);
                }
            } catch (Throwable spawnError) {
                LOGGER.error("Minecraft could not spawn death loot {} x{} for {}.",
                        stack.getItem(), stack.getCount(), player.getGameProfile().name(), spawnError);
            }
        }
    }

    private ChestResult createDeathChest(
            ServerPlayer player,
            List<ItemStack> stacks,
            DeathLootConfig currentConfig
    ) {
        ServerLevel level = player.level();
        boolean needsDouble = stacks.size() > CHEST_SLOTS;
        GridPos deathPosition = fromBlockPos(player.blockPosition());
        Optional<ChestPlacementPlan> planned = PlacementPlanner.find(
                deathPosition,
                needsDouble,
                gridPos -> canPlaceChest(level, player, toBlockPos(gridPos)));
        if (planned.isEmpty()) {
            LOGGER.warn("No safe death-chest position was available near {} for {}.",
                    player.blockPosition(), player.getGameProfile().name());
            return null;
        }

        ChestPlacementPlan plan = planned.get();
        BlockPos firstPos = toBlockPos(plan.first());
        BlockPos secondPos = plan.secondPosition().map(ServerDeathLootFabric::toBlockPos).orElse(null);
        List<ChestBlockEntity> created = new ArrayList<>(plan.isDouble() ? 2 : 1);
        boolean firstPlaced = false;
        boolean secondPlaced = false;
        try {
            if (!plan.isDouble()) {
                BlockState state = Blocks.CHEST.defaultBlockState()
                        .setValue(ChestBlock.FACING, Direction.NORTH)
                        .setValue(ChestBlock.TYPE, ChestType.SINGLE);
                firstPlaced = level.setBlock(firstPos, state, BLOCK_FLAGS);
                if (!firstPlaced) return null;
            } else {
                Direction connection = toDirection(plan.connection());
                Direction facing = connection.getCounterClockWise();
                BlockState firstState = Blocks.CHEST.defaultBlockState()
                        .setValue(ChestBlock.FACING, facing)
                        .setValue(ChestBlock.TYPE, ChestType.LEFT);
                BlockState secondState = Blocks.CHEST.defaultBlockState()
                        .setValue(ChestBlock.FACING, facing)
                        .setValue(ChestBlock.TYPE, ChestType.RIGHT);
                firstPlaced = level.setBlock(firstPos, firstState, BLOCK_FLAGS);
                if (!firstPlaced) return null;
                secondPlaced = level.setBlock(secondPos, secondState, BLOCK_FLAGS);
                if (!secondPlaced) {
                    removeChestBlockWithoutDrops(level, firstPos);
                    return null;
                }
            }

            ChestBlockEntity firstChest = chestAt(level, firstPos);
            if (firstChest == null) throw new IllegalStateException("first chest block entity was not created");
            created.add(firstChest);
            if (secondPos != null) {
                ChestBlockEntity secondChest = chestAt(level, secondPos);
                if (secondChest == null) throw new IllegalStateException("second chest block entity was not created");
                created.add(secondChest);
            }

            String deathId = UUID.randomUUID().toString();
            long expiresAt = ExpiryPolicy.deadlineMillis(
                    System.currentTimeMillis(),
                    currentConfig.deathChestLifetimeSeconds());
            for (ChestBlockEntity chest : created) {
                ((DeathChestMarker) (Object) chest).serverDeathLoot$mark(deathId, expiresAt);
            }
            for (int index = 0; index < stacks.size(); index++) {
                int chestIndex = index / CHEST_SLOTS;
                int slot = index % CHEST_SLOTS;
                created.get(chestIndex).setItem(slot, stacks.get(index));
            }
            for (ChestBlockEntity chest : created) {
                chest.setChanged();
                trackIfExpiringChest(chest, level);
            }
            level.updateNeighborsAt(firstPos, Blocks.CHEST);
            if (secondPos != null) level.updateNeighborsAt(secondPos, Blocks.CHEST);

            if (currentConfig.placeTorches()) placeTorches(level, player, plan);
            LOGGER.info("Stored {} inventory stacks for {} in {} death chest at {} (expires={}).",
                    stacks.size(),
                    player.getGameProfile().name(),
                    plan.isDouble() ? "a double" : "a single",
                    firstPos,
                    expiresAt == 0L ? "never" : expiresAt);
            return new ChestResult(firstPos, plan.isDouble());
        } catch (Throwable error) {
            for (ChestBlockEntity chest : created) {
                try {
                    chest.clearContent();
                    chest.setChanged();
                } catch (Throwable ignored) {
                    // Continue rolling back every placed half.
                }
            }
            if (secondPlaced && secondPos != null) removeChestBlockWithoutDrops(level, secondPos);
            if (firstPlaced) removeChestBlockWithoutDrops(level, firstPos);
            LOGGER.error("Death chest transaction rolled back at {}.", firstPos, error);
            return null;
        }
    }

    private boolean canPlaceChest(ServerLevel level, ServerPlayer player, BlockPos pos) {
        if (!player.mayBuild()
                || !isChunkLoaded(level, pos)
                || level.isOutsideBuildHeight(pos)
                || level.isOutsideBuildHeight(pos.above())
                || !level.getWorldBorder().isWithinBounds(pos)
                || !level.mayInteract(player, pos)
                || !level.getBlockState(pos).isAir()) {
            return false;
        }
        BlockState chest = Blocks.CHEST.defaultBlockState();
        if (!chest.canSurvive(level, pos)
                || !level.isUnobstructed(chest, pos, CollisionContext.placementContext(player))) {
            return false;
        }
        return level.getBlockState(pos.above()).getCollisionShape(level, pos.above()).isEmpty();
    }

    private ChestBlockEntity chestAt(ServerLevel level, BlockPos pos) {
        BlockEntity blockEntity = level.getBlockEntity(pos);
        return blockEntity instanceof ChestBlockEntity chest ? chest : null;
    }

    private void placeTorches(ServerLevel level, ServerPlayer player, ChestPlacementPlan plan) {
        BlockPos first = toBlockPos(plan.first());
        if (!plan.isDouble()) {
            tryPlaceTorch(level, player, first.relative(Direction.WEST));
            tryPlaceTorch(level, player, first.relative(Direction.EAST));
            return;
        }
        Direction connection = toDirection(plan.connection());
        BlockPos second = toBlockPos(plan.second());
        tryPlaceTorch(level, player, first.relative(connection.getOpposite()));
        tryPlaceTorch(level, player, second.relative(connection));
    }

    private void tryPlaceTorch(ServerLevel level, ServerPlayer player, BlockPos pos) {
        BlockState torch = Blocks.TORCH.defaultBlockState();
        if (!isChunkLoaded(level, pos)
                || level.isOutsideBuildHeight(pos)
                || !level.getWorldBorder().isWithinBounds(pos)
                || !level.mayInteract(player, pos)
                || !level.getBlockState(pos).isAir()
                || !torch.canSurvive(level, pos)
                || !level.isUnobstructed(torch, pos, CollisionContext.placementContext(player))) {
            return;
        }
        level.setBlock(pos, torch, Block.UPDATE_ALL);
    }

    private void trackIfExpiringChest(BlockEntity blockEntity, ServerLevel level) {
        if (!(blockEntity instanceof ChestBlockEntity) || !(blockEntity instanceof DeathChestMarker marker)) return;
        long expiresAt = marker.serverDeathLoot$expiresAtMillis();
        if (!marker.serverDeathLoot$isMarked() || expiresAt <= 0L) return;
        loadedExpiringChests.put(
                ChestKey.of(level, blockEntity.getBlockPos()),
                new TrackedChest(marker.serverDeathLoot$deathId(), expiresAt));
    }

    private void expireLoadedChests(MinecraftServer server, long nowMillis) {
        if (loadedExpiringChests.isEmpty()) return;
        List<Map.Entry<ChestKey, TrackedChest>> due = loadedExpiringChests.entrySet().stream()
                .filter(entry -> ExpiryPolicy.isExpired(entry.getValue().expiresAtMillis(), nowMillis))
                .toList();
        for (Map.Entry<ChestKey, TrackedChest> entry : due) {
            ChestKey key = entry.getKey();
            ServerLevel level = findLevel(server, key.dimension());
            if (level == null) {
                loadedExpiringChests.remove(key);
                continue;
            }
            BlockPos pos = BlockPos.of(key.packedPosition());
            if (!isChunkLoaded(level, pos)) continue;
            BlockEntity blockEntity = level.getBlockEntity(pos);
            if (!(blockEntity instanceof ChestBlockEntity chest)
                    || !(blockEntity instanceof DeathChestMarker marker)
                    || !entry.getValue().deathId().equals(marker.serverDeathLoot$deathId())) {
                loadedExpiringChests.remove(key);
                continue;
            }
            chest.clearContent();
            chest.setChanged();
            removeChestBlockWithoutDrops(level, pos);
            loadedExpiringChests.remove(key);
            LOGGER.info("Expired death chest {} at {} in {}.",
                    entry.getValue().deathId(), pos, key.dimension());
        }
    }

    private ServerLevel findLevel(MinecraftServer server, String identifier) {
        for (ServerLevel level : server.getAllLevels()) {
            if (level.dimension().identifier().toString().equals(identifier)) return level;
        }
        return null;
    }

    private static void removeChestBlockWithoutDrops(ServerLevel level, BlockPos pos) {
        BlockEntity blockEntity = level.getBlockEntity(pos);
        if (blockEntity instanceof ChestBlockEntity chest) {
            chest.clearContent();
            chest.setChanged();
        }
        if (level.getBlockState(pos).is(Blocks.CHEST)) {
            level.setBlock(pos, Blocks.AIR.defaultBlockState(), REMOVE_BLOCK_FLAGS);
        }
    }

    private static boolean isChunkLoaded(ServerLevel level, BlockPos pos) {
        return level.hasChunk(
                SectionPos.blockToSectionCoord(pos.getX()),
                SectionPos.blockToSectionCoord(pos.getZ()));
    }

    private int reload(net.minecraft.commands.CommandSourceStack source) {
        if (loadConfig(true)) {
            source.sendSuccess(() -> Component.literal(
                    "Server Death Loot reloaded: " + config.mode().configValue() + "."), false);
            return 1;
        }
        source.sendFailure(Component.literal("Server Death Loot could not reload its config. Check the server log."));
        return 0;
    }

    private int sendStatus(net.minecraft.commands.CommandSourceStack source) {
        DeathLootConfig current = config;
        String chestLifetime = current.deathChestLifetimeSeconds() == 0
                ? "never expires"
                : current.deathChestLifetimeSeconds() + "s";
        source.sendSuccess(() -> Component.literal(
                "Server Death Loot: mode=" + current.mode().configValue()
                        + ", death drops=" + current.deathDropLifetimeSeconds() + "s"
                        + ", death chests=" + chestLifetime
                        + ", torches=" + current.placeTorches() + "."), false);
        return 1;
    }

    private boolean loadConfig(boolean reload) {
        try {
            DeathLootConfig.LoadResult result = DeathLootConfig.load(configFile);
            config = result.config();
            for (String warning : result.warnings()) LOGGER.warn("Config: {}", warning);
            if (result.created()) LOGGER.info("Created default config at {}.", configFile);
            return true;
        } catch (IOException | RuntimeException error) {
            if (!reload) config = DeathLootConfig.defaults();
            LOGGER.error("Could not {} {}; {} settings remain active: {}",
                    reload ? "reload" : "load",
                    configFile,
                    reload ? "the previous" : "safe default",
                    error.getMessage());
            return false;
        }
    }

    private void safelyNotifyChest(ServerPlayer player, ChestResult chest, int lifetimeSeconds) {
        try {
            String lifetime = lifetimeSeconds == 0
                    ? " It will not expire."
                    : " It expires in " + lifetimeSeconds + " seconds.";
            player.sendSystemMessage(Component.literal(
                    "Your items are in " + (chest.doubleChest() ? "a double" : "a")
                            + " death chest at " + chest.position().getX() + " "
                            + chest.position().getY() + " " + chest.position().getZ() + "." + lifetime));
        } catch (Throwable error) {
            LOGGER.warn("Could not send the death-chest location to {}: {}",
                    player.getGameProfile().name(), error.getMessage());
        }
    }

    private void safelyNotifyFallback(ServerPlayer player) {
        try {
            player.sendSystemMessage(Component.literal(
                    "A death chest could not be placed safely, so your items were dropped instead."));
        } catch (Throwable error) {
            LOGGER.warn("Could not send the death-loot fallback message to {}: {}",
                    player.getGameProfile().name(), error.getMessage());
        }
    }

    private static GridPos fromBlockPos(BlockPos pos) {
        return new GridPos(pos.getX(), pos.getY(), pos.getZ());
    }

    private static BlockPos toBlockPos(GridPos pos) {
        return new BlockPos(pos.x(), pos.y(), pos.z());
    }

    private static Direction toDirection(HorizontalStep direction) {
        return switch (direction) {
            case EAST -> Direction.EAST;
            case SOUTH -> Direction.SOUTH;
            case WEST -> Direction.WEST;
            case NORTH -> Direction.NORTH;
        };
    }

    private record ChestKey(String dimension, long packedPosition) {
        private static ChestKey of(ServerLevel level, BlockPos position) {
            return new ChestKey(level.dimension().identifier().toString(), position.asLong());
        }
    }

    private record TrackedChest(String deathId, long expiresAtMillis) {}

    private record ChestResult(BlockPos position, boolean doubleChest) {}

    private record CapturedStack(int slot, ItemStack stack) {}

    private static final class InventoryCaptureException extends RuntimeException {
        private InventoryCaptureException(Throwable cause) {
            super(cause);
        }
    }
}
