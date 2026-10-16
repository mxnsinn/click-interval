package dev.serverenchantments.fabric;

import dev.serverenchantments.fabric.core.HarvestConfig;
import dev.serverenchantments.fabric.core.HarvestBudget;
import dev.serverenchantments.fabric.core.TreeScan;
import dev.serverenchantments.fabric.core.TreeSpecies;
import dev.serverenchantments.fabric.core.WideStrip;
import dev.serverenchantments.fabric.core.HarvestArea;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.commands.Commands;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;

public final class ServerEnchantmentsFabric implements ModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("serverenchantments_fabric");
    // Preserve the published ID so existing books, tools, and offers survive the display-name correction.
    private static final ResourceKey<Enchantment> CHOP = key("cheery_chop");
    private static final ResourceKey<Enchantment> WIDE = key("wide_miner");
    private static final ResourceKey<Enchantment> HARVEST = key("harvester_sweep");
    private static ServerPlayer automaticPlayer;
    private static BlockPos automaticPosition;
    private static ServerEnchantmentsFabric active;
    private final Map<UUID, Strike> strikes = new HashMap<>();
    private final LinkedHashMap<UUID, Job> jobs = new LinkedHashMap<>();
    private final Map<UUID, CenterReplant> centerReplants = new HashMap<>();
    private final Map<UUID, Long> nextToggle = new HashMap<>();
    private final Map<UUID, Long> nextMenu = new HashMap<>();
    private final Map<UUID, Long> nextSwap = new HashMap<>();
    private PlayerToggleStore toggles;
    private HarvestConfig config = HarvestConfig.defaults();
    private HarvestBudget budget = new HarvestBudget(2_000_000L);
    private long ticks;
    private boolean draining;

    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> {
            var toggleCommand = Commands.literal("toggle");
            for (PlayerToggleStore.Feature feature : PlayerToggleStore.Feature.values())
                toggleCommand.then(Commands.literal(feature.id).executes(context -> {
                    ServerPlayer player = context.getSource().getPlayerOrException();
                    if (toggles == null || !toggle(player, feature)) return 0;
                    if (player.containerMenu instanceof EnchantmentToggleMenu) EnchantmentToggleMenu.open(player, this);
                    return 1;
                }));
            // Never merge our public self controls into another mod's possibly privileged command.
            String root = dispatcher.getRoot().getChild("enchants") == null ? "enchants" : "serverenchantments";
            if (!root.equals("enchants")) LOGGER.warn("/enchants is already registered; using /serverenchantments for self toggles");
            if (dispatcher.getRoot().getChild(root) != null) {
                LOGGER.warn("Both enchantment toggle command names are occupied; crouch + swap-offhand remains available");
                return;
            }
            dispatcher.register(Commands.literal(root).executes(context -> {
                ServerPlayer player = context.getSource().getPlayerOrException();
                if (toggles == null || !allowInput(nextMenu, player.getUUID(), 6)) return 0;
                EnchantmentToggleMenu.open(player, this);
                return 1;
            }).then(toggleCommand));
        });
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            active = this;
            toggles = new PlayerToggleStore(server.getWorldPath(LevelResource.ROOT).resolve("server-enchantments"), LOGGER::warn);
            nextToggle.clear();
            nextMenu.clear();
            nextSwap.clear();
            try { config = HarvestConfig.load(FabricLoader.getInstance().getConfigDir().resolve("server-enchantments.properties")); }
            catch (IOException failure) { LOGGER.warn("Could not read harvest config; bounded defaults remain active", failure); }
            ticks = 0;
            jobs.clear();
            strikes.clear();
            centerReplants.clear();
            budget.reset(config.scansPerTick(), config.breaksPerTick());
            // Force registry validation at startup rather than on the first player's block break.
            server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(CHOP);
            server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(WIDE);
            server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(HARVEST);
            server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(key("smelter"));
            for (ServerLevel level : server.getAllLevels()) level.getDataStorage().computeIfAbsent(PlacedLogs.TYPE);
            LOGGER.info("Server Enchantments 1.4.0 ready: per-player /enchants toggles, Tree Chop, Miner's Sweep I/II, Harvester Sweep I/II/III, Smelter and survival anvil cap39; max-tree-logs={}, global-breaks-per-tick={}", config.maxTreeLogs(), config.breaksPerTick());
        });
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> { jobs.clear(); strikes.clear(); centerReplants.clear(); nextToggle.clear(); nextMenu.clear(); nextSwap.clear(); toggles=null; automaticPlayer=null; automaticPosition=null; draining=false; if (active==this) active=null; });
        ServerPlayConnectionEvents.DISCONNECT.register((handler,server) -> {
            UUID id = handler.getPlayer().getUUID();
            jobs.remove(id); strikes.remove(id); centerReplants.remove(id); nextToggle.remove(id); nextMenu.remove(id); nextSwap.remove(id);
            if (toggles != null) toggles.forget(id);
        });
        AttackBlockCallback.EVENT.register((player, level, hand, pos, face) -> {
            if (player instanceof ServerPlayer serverPlayer && hand == InteractionHand.MAIN_HAND && !isAutomaticBreak(serverPlayer))
                strikes.put(player.getUUID(), new Strike(pos.immutable(), face, ticks));
            return InteractionResult.PASS;
        });
        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, entity) -> {
            if (player instanceof ServerPlayer serverPlayer) afterBreak(serverPlayer, pos, state);
        });
        PlayerBlockBreakEvents.BEFORE.register((world, player, pos, state, entity) -> {
            // Zero-hardness crops can receive another attack while the mouse is still held.
            // Never undo a paid replant (or harvest any immature crop) with a Harvester hoe.
            // Sneaking deliberately restores ordinary single-block breaking.
            if (!(player instanceof ServerPlayer serverPlayer) || isAutomaticBreak(serverPlayer)
                    || !eligible(serverPlayer) || CropHarvest.plantingItem(state) == null || CropHarvest.isRipe(state)) return true;
            ItemStack tool = player.getMainHandItem();
            return !enabled(serverPlayer, PlayerToggleStore.Feature.HARVESTER) || !tool.is(ItemTags.HOES) || !enchanted(serverPlayer, tool, HARVEST);
        });
        ServerTickEvents.START_SERVER_TICK.register(this::beginTick);
        ServerTickEvents.END_SERVER_TICK.register(this::tick);
        // Deliberately opt-in: the fixture mutates an isolated test world, never a normal server.
        if (Boolean.getBoolean("serverenchantments.selftest"))
            ServerLifecycleEvents.SERVER_STARTED.register(server -> {
                if (!java.nio.file.Files.isRegularFile(server.getWorldPath(LevelResource.ROOT).resolve("server-market-test-fixture"),
                        java.nio.file.LinkOption.NOFOLLOW_LINKS))
                    throw new IllegalStateException("Enchantment selftests require an explicitly marked disposable world");
                EnchantmentSelfTest.run(server, this);
            });
    }

    PlayerToggleStore.Snapshot toggleSnapshot(ServerPlayer player) { return toggles.get(player.getUUID()); }
    private static boolean enabled(ServerPlayer player, PlayerToggleStore.Feature feature) {
        return active != null && active.toggles != null && active.toggles.enabled(player.getUUID(), feature);
    }
    private boolean allowInput(Map<UUID, Long> gate, UUID id, long cooldown) {
        if (ticks < gate.getOrDefault(id, Long.MIN_VALUE)) return false;
        gate.put(id, ticks + cooldown);
        return true;
    }
    boolean toggle(ServerPlayer player, PlayerToggleStore.Feature feature) {
        if (toggles == null || !player.isAlive() || player.isRemoved() || player.isSpectator()
                || !allowInput(nextToggle, player.getUUID(), 6)) return false;
        boolean next = !toggles.enabled(player.getUUID(), feature);
        try { toggles.set(player.getUUID(), feature, next); }
        catch (IOException failure) {
            LOGGER.warn("Could not save enchantment toggle for {}", player.getUUID(), failure);
            player.sendSystemMessage(Component.literal("Could not save your enchantment preference. Nothing changed."));
            return false;
        }
        if (!next) {
            Job job = jobs.get(player.getUUID());
            if (job != null && job.feature() == feature) jobs.remove(player.getUUID(), job);
            if (feature == PlayerToggleStore.Feature.HARVESTER) centerReplants.remove(player.getUUID());
        }
        player.sendSystemMessage(Component.literal(feature.label + ": " + (next ? "ON" : "OFF")), true);
        return true;
    }
    /** Vanilla fallback; packet execution is already on the server thread. Unsupported swaps pass unchanged. */
    public static boolean handleToggleSwap(ServerPlayer player) {
        ServerEnchantmentsFabric mod = active;
        if (mod == null || mod.toggles == null || !player.connection.hasClientLoaded()
                || !player.isAlive() || player.isRemoved() || player.isSpectator()
                || !player.isShiftKeyDown() || player.containerMenu != player.inventoryMenu) return false;
        ItemStack tool = player.getMainHandItem();
        PlayerToggleStore.Feature feature = null;
        if (tool.is(ItemTags.PICKAXES) && enchanted(player, tool, WIDE)) feature = PlayerToggleStore.Feature.MINER;
        if (tool.is(ItemTags.AXES) && enchanted(player, tool, CHOP)) {
            if (feature != null) return false;
            feature = PlayerToggleStore.Feature.TREE;
        }
        if (tool.is(ItemTags.HOES) && enchanted(player, tool, HARVEST)) {
            if (feature != null) return false;
            feature = PlayerToggleStore.Feature.HARVESTER;
        }
        if (feature == null) return false;
        long previous = mod.nextSwap.getOrDefault(player.getUUID(), Long.MIN_VALUE);
        mod.nextSwap.put(player.getUUID(), mod.ticks + 25);
        // Cover the delayed first OS repeat (up to roughly one second), then keep extending
        // the quiet window on repeats instead of flipping every cooldown. Commands stay snappy.
        if (mod.ticks >= previous) {
            mod.toggle(player, feature);
            player.inventoryMenu.sendAllDataToRemote();
        }
        // Consume matching repeats too: cooldown must never accidentally swap the tool.
        return true;
    }

    /** True only during this mod's synchronous native break; never an exemption for player packets. */
    public static boolean isAutomaticBreak(ServerPlayer player) {
        return player != null && player == automaticPlayer && automaticPosition != null;
    }

    /** Fabric AFTER precedes vanilla's tool damage and drops in26.2. Only the native
     * RETURN hook may release the captured job, after the original transaction finishes.
     */
    public static void finishNativeBreak(ServerPlayer player, BlockPos pos, boolean successful) {
        ServerEnchantmentsFabric mod = active;
        if (mod == null || isAutomaticBreak(player)) return;
        CenterReplant center = mod.centerReplants.get(player.getUUID());
        if (center != null && center.position.equals(pos)) {
            mod.centerReplants.remove(player.getUUID(), center);
            if (successful && eligible(player) && enabled(player, PlayerToggleStore.Feature.HARVESTER)
                    && player.level() == center.level && player.getMainHandItem() == center.tool) {
                // One paid restoration belongs to this manual native break, independent of
                // the one-per-player neighbor job. Rapid input must not lose a center just
                // because earlier extras are waiting for shared work credits.
                long started = System.nanoTime();
                CropHarvest.replant(player, center.level, pos, center.crop);
                mod.budget.chargeNanos(System.nanoTime() - started);
            }
        }
        Job candidate = mod.jobs.get(player.getUUID());
        if (candidate == null || !candidate.awaitingNativeReturn || !candidate.origin.equals(pos)) return;
        if (!successful) {
            // Never cancel unrelated earlier queued work on a later failed manual break.
            mod.jobs.remove(player.getUUID(), candidate);
            return;
        }
        candidate.awaitingNativeReturn = false;
        mod.drainJobs();
    }

    public static void recordPlacedLog(BlockPlaceContext context, BlockState state) {
        if (context.getLevel() instanceof ServerLevel level && state.is(BlockTags.LOGS))
            level.getDataStorage().computeIfAbsent(PlacedLogs.TYPE).add(context.getClickedPos().asLong());
    }

    private void afterBreak(ServerPlayer player, BlockPos pos, BlockState state) {
        PlacedLogs placed = player.level().getDataStorage().computeIfAbsent(PlacedLogs.TYPE);
        boolean wasPlaced = placed.contains(pos.asLong());
        placed.remove(pos.asLong());
        if (isAutomaticBreak(player) || !eligible(player)) return;
        ItemStack tool = player.getMainHandItem();
        boolean chop = enabled(player, PlayerToggleStore.Feature.TREE) && tool.is(ItemTags.AXES) && enchanted(player, tool, CHOP) && naturalLog(state) && !wasPlaced;
        int wideLevel = enabled(player, PlayerToggleStore.Feature.MINER) && tool.is(ItemTags.PICKAXES) ? enchantmentLevel(player, tool, WIDE) : 0;
        boolean wide = wideLevel > 0 && state.is(BlockTags.MINEABLE_WITH_PICKAXE);
        int harvestLevel = enabled(player, PlayerToggleStore.Feature.HARVESTER) && tool.is(ItemTags.HOES) ? enchantmentLevel(player, tool, HARVEST) : 0;
        boolean harvest = harvestLevel > 0 && CropHarvest.isRipe(state);
        if (harvest && harvestLevel >= 2)
            centerReplants.put(player.getUUID(), new CenterReplant(player.level(), pos.immutable(), state, tool));
        if (jobs.containsKey(player.getUUID())) return;
        if (!chop && !wide && !harvest) return;
        if (jobs.size() >= config.maxJobs()) {
            player.sendSystemMessage(Component.literal("Extra harvesting is busy. This block was mined normally."));
            return;
        }
        Strike strike = strikes.remove(player.getUUID());
        if (wide && (strike == null || !strike.position.equals(pos) || ticks-strike.tick>1_200)) return;
        Job job = new Job(player, pos.immutable(), state, tool, ticks, chop, harvest ? harvestLevel : 0);
        if (chop) {
            job.scan = new TreeScan(point(pos), config.maxTreeLogs(), rooted(player.level(), pos));
        } else if (harvest) {
            // The center is restored at its own native RETURN, never left behind a queued sweep.
            HarvestArea.extras(point(pos), player.getDirection().getAxis() == Direction.Axis.Z, harvestLevel)
                    .forEach(p -> job.breaks.add(block(p)));
        } else {
            Direction face = strike.face;
            boolean alongX = face.getAxis() == Direction.Axis.Z ||
                    (face.getAxis() == Direction.Axis.Y && player.getDirection().getAxis() == Direction.Axis.Z);
            WideStrip.Axis axis = WideStrip.Axis.valueOf(face.getAxis().name());
            WideStrip.extras(point(pos), axis, alongX, wideLevel).forEach(p -> job.breaks.add(block(p)));
        }
        jobs.put(player.getUUID(), job);
        // Do not dispatch inside Fabric AFTER: the original tool has not yet paid its
        // durability cost or supplied its loot snapshot. finishNativeBreak releases this
        // candidate at native RETURN, still in the same call without an extra tick.
    }

    void beginTick(MinecraftServer server) {
        ticks++;
        // AFTER and native RETURN are synchronous; an entry left by a third-party exception
        // must never restore an unrelated block during a future tick.
        centerReplants.clear();
        if (ticks % 200 == 0) strikes.entrySet().removeIf(entry -> ticks-entry.getValue().tick>1_200);
        budget.reset(config.scansPerTick(), config.breaksPerTick());
    }

    /** END tick spends only the budget left by immediate break callbacks, never a second cap. */
    void tick(MinecraftServer server) { drainJobs(); }

    private void drainJobs() {
        if (draining || jobs.isEmpty() || !budget.hasTime(0)) return;
        draining = true;
        long startedNanos = System.nanoTime();
        try {
            int idleTurns = 0;
            while (!jobs.isEmpty() && budget.hasTime(System.nanoTime() - startedNanos)) {
                // Remove before native callbacks: callbacks may enqueue another player's work.
                // Returning work goes to the tail, preserving fairness across dispatches/ticks.
                Map.Entry<UUID, Job> entry = jobs.pollFirstEntry();
                Job job = entry.getValue();
                int scansBefore = budget.scansLeft();
                int breaksBefore = budget.breaksLeft();
                boolean keep = valid(job) && ticks-job.started<=600 && (job.awaitingNativeReturn || stepJob(job));
                if (keep) jobs.put(entry.getKey(), job);
                boolean progressed = !keep || scansBefore != budget.scansLeft() || breaksBefore != budget.breaksLeft();
                idleTurns = progressed ? 0 : idleTurns + 1;
                // A full turn with no usable scan/break budget must not spin until the deadline.
                if (idleTurns >= jobs.size()) break;
            }
        } finally {
            budget.chargeNanos(System.nanoTime() - startedNanos);
            draining = false;
        }
    }

    /** One fair quantum:32 scan positions, one probe, or a fully planned <=8-probe batch. */
    private boolean stepJob(Job job) {
        if (job.scan != null) {
            int allowance = budget.scanAllowance(32);
            if (allowance <= 0) return true;
            budget.consumeScans(job.scan.step(allowance, p -> inspect(job, p)));
            if (!job.scan.finished()) return true;
            if (!job.scan.valid()) {
                job.player.sendSystemMessage(Component.literal("Tree Chop needs a complete natural tree within " + config.maxTreeLogs() + " logs. Extra logs were left intact."));
                return false;
            }
            job.scan.plan().forEach(p -> job.breaks.add(block(p)));
            job.scan = null;
            // Yield after discovery too, allowing the dispatcher to recheck time/fairness
            // before the first potentially expensive native break.
            return true;
        }
        if (job.breaks.isEmpty()) return false;
        // A normal Sweep II/small tree is one bounded atomic operation, not visibly
        // trickled across ticks. Start only with all required global probe credits and
        // positive soft time. Its full elapsed cost is then charged to the tick, stopping
        // other work when exhausted. Larger/under-credit jobs keep single-probe fairness.
        int probes = job.breaks.size() <= 8 && budget.breaksLeft() >= job.breaks.size()
                ? job.breaks.size() : 1;
        for (int index = 0; index < probes; index++) if (!breakOne(job)) return false;
        return true;
    }

    private boolean breakOne(Job job) {
        if (!valid(job) || job.breaks.isEmpty()) return false;
        if (!budget.tryBreak()) return true;
        BlockPos position = job.breaks.removeFirst();
        if (!canBreak(job, position)) {
            // A tree is one connected operation: protection/tool changes stop it.
            // Sweep may encounter air/non-minable blocks; those are bounded skipped probes.
            return !job.chop && !job.breaks.isEmpty();
        }
        boolean broken;
        BlockState crop = job.harvestLevel >= 2 ? job.level.getBlockState(position) : null;
        automaticPlayer = job.player;
        automaticPosition = position;
        try { broken = job.player.gameMode.destroyBlock(position); }
        catch (RuntimeException error) { LOGGER.warn("Extra harvesting stopped safely for {}", job.player.getGameProfile().name(), error); broken=false; }
        finally { automaticPlayer=null; automaticPosition=null; }
        if (broken && crop != null && valid(job)) CropHarvest.replant(job.player, job.level, position, crop);
        return broken && !job.breaks.isEmpty() && valid(job);
    }

    private TreeScan.Kind inspect(Job job, TreeScan.Point point) {
        BlockPos pos = block(point);
        if (!job.level.hasChunkAt(pos)) return TreeScan.Kind.UNAVAILABLE;
        BlockState state = job.level.getBlockState(pos);
        if (state.is(job.original.getBlock()) && !job.placed.contains(pos.asLong()))
            return rooted(job.level,pos) ? TreeScan.Kind.ROOTED_LOG : TreeScan.Kind.LOG;
        String logId = BuiltInRegistries.BLOCK.getKey(job.original.getBlock()).getPath();
        Identifier id = BuiltInRegistries.BLOCK.getKey(state.getBlock());
        if (state.hasProperty(BlockStateProperties.PERSISTENT) && TreeSpecies.matchingNaturalLeaves(
                logId,id.getNamespace(),id.getPath(),state.getValue(BlockStateProperties.PERSISTENT))) return TreeScan.Kind.NATURAL_LEAF;
        return TreeScan.Kind.OTHER;
    }

    private static boolean rooted(ServerLevel level, BlockPos pos) {
        return level.hasChunkAt(pos.below()) && level.getBlockState(pos.below()).is(BlockTags.DIRT);
    }
    private static boolean eligible(ServerPlayer player) {
        return player.isAlive() && !player.isRemoved() && !player.isCreative() && !player.isSpectator()
                && player.mayBuild() && !player.isShiftKeyDown();
    }
    private static boolean valid(Job job) {
        return eligible(job.player) && enabled(job.player, job.feature()) && job.player.level() == job.level && job.player.getMainHandItem() == job.tool
                && !job.tool.isEmpty() && enchanted(job.player, job.tool, job.chop ? CHOP : job.harvestLevel > 0 ? HARVEST : WIDE)
                && job.player.position().distanceToSqr(job.origin.getX()+0.5, job.origin.getY()+0.5, job.origin.getZ()+0.5) <= 36*36;
    }
    private static boolean canBreak(Job job, BlockPos pos) {
        if (!job.level.hasChunkAt(pos) || !job.level.getWorldBorder().isWithinBounds(pos) ||
                !job.level.mayInteract(job.player,pos) || job.player.blockActionRestricted(job.level,pos,job.player.gameMode.getGameModeForPlayer())) return false;
        BlockState state = job.level.getBlockState(pos);
        if (state.isAir() || state.hasBlockEntity() || state.getDestroySpeed(job.level,pos)<0 ||
                !job.player.hasCorrectToolForDrops(state)) return false;
        if (job.chop) return state.is(job.original.getBlock()) && !job.placed.contains(pos.asLong());
        if (job.harvestLevel > 0) return CropHarvest.isRipe(state);
        // Never turn a cheap stone break into multiple instant obsidian/ancient-debris breaks.
        return state.is(BlockTags.MINEABLE_WITH_PICKAXE) && state.getDestroySpeed(job.level,pos) <=
                Math.max(0,job.original.getDestroySpeed(job.level,job.origin))*1.5f;
    }
    private static boolean naturalLog(BlockState state) {
        Identifier id=BuiltInRegistries.BLOCK.getKey(state.getBlock());
        return TreeSpecies.naturalLog(id.getNamespace(),id.getPath());
    }
    private static boolean enchanted(ServerPlayer player, ItemStack tool, ResourceKey<Enchantment> key) {
        return enchantmentLevel(player, tool, key) > 0;
    }
    private static int enchantmentLevel(ServerPlayer player, ItemStack tool, ResourceKey<Enchantment> key) {
        return player.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).get(key)
                .map(holder -> EnchantmentHelper.getItemEnchantmentLevel(holder,tool)).orElse(0);
    }
    private static ResourceKey<Enchantment> key(String name) { return ResourceKey.create(Registries.ENCHANTMENT,Identifier.fromNamespaceAndPath("serverenchantments",name)); }
    private static TreeScan.Point point(BlockPos p) { return new TreeScan.Point(p.getX(),p.getY(),p.getZ()); }
    private static BlockPos block(TreeScan.Point p) { return new BlockPos(p.x(),p.y(),p.z()); }
    private record Strike(BlockPos position, Direction face, long tick) { }
    private record CenterReplant(ServerLevel level, BlockPos position, BlockState crop, ItemStack tool) { }
    private static final class Job {
        final ServerPlayer player;
        final ServerLevel level;
        final PlacedLogs placed;
        final BlockPos origin;
        final BlockState original;
        final ItemStack tool;
        final long started;
        final boolean chop;
        final int harvestLevel;
        boolean awaitingNativeReturn = true;
        final ArrayDeque<BlockPos> breaks = new ArrayDeque<>();
        TreeScan scan;
        PlayerToggleStore.Feature feature() { return chop ? PlayerToggleStore.Feature.TREE : harvestLevel > 0 ? PlayerToggleStore.Feature.HARVESTER : PlayerToggleStore.Feature.MINER; }
        Job(ServerPlayer player,BlockPos origin,BlockState original,ItemStack tool,long started,boolean chop,int harvestLevel) {
            this.player=player;this.level=player.level();this.placed=level.getDataStorage().computeIfAbsent(PlacedLogs.TYPE);
            this.origin=origin;this.original=original;this.tool=tool;this.started=started;this.chop=chop;this.harvestLevel=harvestLevel;
        }
    }
}
