package com.clickinterval.endlock;

import com.clickinterval.endlock.mixin.CommandSourceAccessor;
import com.mojang.brigadier.arguments.BoolArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.minecraft.core.Direction;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.rcon.RconConsoleSource;
import net.minecraft.server.level.TicketType;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeInput;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.portal.PortalShape;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.util.Map;
import java.util.WeakHashMap;
import static com.clickinterval.endlock.EndLockState.Domain.END;
import static com.clickinterval.endlock.EndLockState.Domain.NETHER;

public final class ServerEndLock implements ModInitializer {
    public static final Logger LOGGER = LoggerFactory.getLogger("ServerEndLock");
    private static final Map<MinecraftServer, EndLockState> STATES = new WeakHashMap<>();
    private static final Map<MinecraftServer, LockRuntime> RUNTIMES = new WeakHashMap<>();
    static TicketType evacuationTicket;
    static TicketType originEvacuationTicket;

    @Override public void onInitialize() {
        evacuationTicket = Registry.register(BuiltInRegistries.TICKET_TYPE,
                Identifier.fromNamespaceAndPath("serverendlock", "safe_spawn_evacuation"),
                new TicketType(300L, TicketType.FLAG_LOADING));
        originEvacuationTicket = Registry.register(BuiltInRegistries.TICKET_TYPE,
                Identifier.fromNamespaceAndPath("serverendlock", "known_origin_evacuation"),
                new TicketType(300L, TicketType.FLAG_LOADING));
        ServerLifecycleEvents.SERVER_STARTING.register(server -> {
            EndLockState current = state(server);
            current.refresh(System.currentTimeMillis());
            LOGGER.info("Dimension locks loaded: End={}, Nether={}. Console or host with cheats: endlock/netherlock on|off|status|for <1d>.",
                    current.locked() ? "LOCKED" : "UNLOCKED", current.locked(NETHER, System.currentTimeMillis()) ? "LOCKED" : "UNLOCKED");
            if (!current.error().isEmpty()) LOGGER.error("End lock failed closed: {}", current.error());
        });
        ServerTickEvents.END_SERVER_TICK.register(server -> runtime(server).tick(server));
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            EndLockState current = state(server);
            if (current.startPendingTimers(System.currentTimeMillis())) LOGGER.info("Opening-period timers started: {} {}",
                    lockMessage(current, NETHER, System.currentTimeMillis()), lockMessage(current, END, System.currentTimeMillis()));
            if (!current.error().isEmpty()) LOGGER.error("Opening-period timers remain safely locked: {}", current.error());
        });
        ServerLivingEntityEvents.ALLOW_DAMAGE.register((entity, source, amount) ->
                !(source.getEntity() instanceof ServerPlayer attacker && protectedDuringEvacuation(attacker)));
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> runtime(server).joined(handler.getPlayer()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> runtime(server).disconnected(server, handler.getPlayer()));
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            synchronized (RUNTIMES) { LockRuntime runtime = RUNTIMES.remove(server); if (runtime != null) runtime.close(server); }
            synchronized (STATES) { STATES.remove(server); }
        });
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> {
            dispatcher.register(command("endlock", END)
                    .then(Commands.literal("eyes").then(Commands.argument("blocked", BoolArgumentType.bool())
                            .executes(context -> configureEye(context.getSource(), true, BoolArgumentType.getBool(context, "blocked")))))
                    .then(Commands.literal("frames").then(Commands.argument("blocked", BoolArgumentType.bool())
                            .executes(context -> configureEye(context.getSource(), false, BoolArgumentType.getBool(context, "blocked"))))));
            dispatcher.register(command("netherlock", NETHER));
        });
        UseBlockCallback.EVENT.register((player, level, hand, hit) -> {
            if (!(player instanceof ServerPlayer) || level.dimension().equals(Level.NETHER) || !locked(level, NETHER)) return InteractionResult.PASS;
            var held = player.getItemInHand(hand);
            if (!held.is(Items.FLINT_AND_STEEL) && !held.is(Items.FIRE_CHARGE)) return InteractionResult.PASS;
            var target = hit.getBlockPos().relative(hit.getDirection());
            if (PortalShape.findEmptyPortalShape(level, target, Direction.Axis.X).isPresent()
                    || PortalShape.findEmptyPortalShape(level, target, Direction.Axis.Z).isPresent()) {
                notifyBlocked(player, NETHER);
                return InteractionResult.FAIL;
            }
            return InteractionResult.PASS;
        });
        if (Boolean.getBoolean("serverendlock.selftest")) ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            if (!Files.isRegularFile(server.getWorldPath(LevelResource.ROOT).resolve("server-market-test-fixture"))) {
                throw new IllegalStateException("End lock selftests require an explicitly marked disposable fixture world");
            }
            EndLockSelfTest.run(server);
            DimensionLockSelfTest.run(server);
        });
    }

    public static EndLockState state(MinecraftServer server) {
        synchronized (STATES) {
            return STATES.computeIfAbsent(server, key -> new EndLockState(
                    key.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/state.properties")));
        }
    }

    public static boolean locked(Level level) {
        return locked(level, END);
    }

    public static boolean locked(Level level, EndLockState.Domain domain) {
        // Never modify client prediction or require a remote player to install this mod.
        return level != null && !level.isClientSide() && level.getServer() != null
                && state(level.getServer()).locked(domain, System.currentTimeMillis());
    }

    static LockRuntime runtime(MinecraftServer server) {
        synchronized (RUNTIMES) { return RUNTIMES.computeIfAbsent(server, key -> new LockRuntime(
                key.getWorldPath(LevelResource.ROOT).resolve("server-end-lock/nether-origins"))); }
    }

    public static boolean blocksEyes(Level level) { return locked(level) && state(level.getServer()).eyeCraftingBlocked(); }
    public static boolean blocksFrames(Level level) { return locked(level) && state(level.getServer()).frameInsertionBlocked(); }

    /** Protection is automatic only while moving a living player out of a locked Nether, plus brief arrival grace. */
    public static boolean protectedDuringEvacuation(ServerPlayer player) {
        return player.isAlive() && (player.level().dimension().equals(Level.NETHER) && locked(player.level(), NETHER)
                || runtime(player.level().getServer()).arrivalProtected(player));
    }

    public static boolean blocksEntry(Entity entity, Level destination) {
        if (destination == null || destination.dimension().equals(entity.level().dimension())) return false;
        EndLockState.Domain domain = destination.dimension().equals(Level.END) ? END
                : destination.dimension().equals(Level.NETHER) ? NETHER : null;
        boolean denied = domain != null && locked(entity.level(), domain);
        if (denied) notifyBlocked(entity, domain);
        return denied;
    }

    public static void notifyBlocked(Entity entity, EndLockState.Domain domain) {
        if (entity instanceof ServerPlayer player) runtime(player.level().getServer()).notice(player, domain, null);
    }

    public static NetherOriginStore.Origin captureNetherOrigin(ServerPlayer player, Level destination) {
        if (!destination.dimension().equals(Level.NETHER) || player.level().dimension().equals(Level.NETHER)) return null;
        try { return new NetherOriginStore.Origin(player.level().dimension().identifier().toString(),
                player.getX(), player.getY(), player.getZ(), player.getYRot(), player.getXRot()); }
        catch (IllegalArgumentException invalid) { return null; }
    }

    public static void completedNetherEntry(ServerPlayer player, NetherOriginStore.Origin origin) {
        if (origin != null && player != null && player.level().dimension().equals(Level.NETHER)) {
            runtime(player.level().getServer()).remember(player, origin);
        }
    }

    public static boolean blocksRecipe(RecipeInput input, RecipeHolder<?> holder, Level level) {
        return holder != null && blocksEyes(level) && input instanceof CraftingInput crafting
                && holder.value() instanceof CraftingRecipe recipe && recipe.assemble(crafting).is(Items.ENDER_EYE);
    }

    public static boolean consoleOnly(CommandSourceStack source) {
        Object caller = ((CommandSourceAccessor) source).serverEndLock$source();
        return caller instanceof MinecraftServer || caller instanceof RconConsoleSource;
    }

    public static boolean canManage(CommandSourceStack source) {
        if (consoleOnly(source)) return true;
        MinecraftServer server = source.getServer();
        if (!(source.getEntity() instanceof ServerPlayer player)) return false;
        var host = server.getSingleplayerProfile();
        Object caller = ((CommandSourceAccessor) source).serverEndLock$source();
        return HostCommandAccess.allowed(server.isDedicatedServer(), host == null ? null : host.id(),
                player.getUUID(), server.isSingleplayerOwner(new NameAndId(player.getGameProfile())),
                caller == player.commandSource() && server.getPlayerList().getPlayer(player.getUUID()) == player,
                source.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER)
                        && player.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER));
    }

    private static LiteralArgumentBuilder<CommandSourceStack> command(String name, EndLockState.Domain domain) {
        return Commands.literal(name).requires(ServerEndLock::canManage)
                .executes(context -> status(context.getSource(), domain))
                .then(Commands.literal("status").executes(context -> status(context.getSource(), domain)))
                .then(Commands.literal("on").executes(context -> change(context.getSource(), domain, true, null)))
                .then(Commands.literal("off").executes(context -> change(context.getSource(), domain, false, null)))
                .then(Commands.literal("for").then(Commands.argument("duration", StringArgumentType.word())
                        .executes(context -> change(context.getSource(), domain, true, StringArgumentType.getString(context, "duration")))));
    }

    static String label(EndLockState.Domain domain) { return domain == END ? "End" : "Nether"; }

    static String lockMessage(EndLockState current, EndLockState.Domain domain, long now) {
        if (!current.locked(domain, now)) return label(domain) + " unlocked.";
        long remaining = current.remaining(domain, now);
        if (!current.error().isEmpty()) return label(domain) + " locked (state storage error; awaiting safe recovery).";
        if (current.startOnLaunchMillis(domain) > 0) return label(domain) + " closed for the first "
                + openingPeriod(current.startOnLaunchMillis(domain)) + "; timer starts when the server opens.";
        if (current.openingDurationMillis(domain) > 0) return label(domain) + " closed for the first "
                + openingPeriod(current.openingDurationMillis(domain)) + ". Opens in " + DurationSpec.formatMillis(remaining) + ".";
        return remaining < 0 ? label(domain) + " locked indefinitely." : label(domain) + " opens in " + DurationSpec.formatMillis(remaining) + ".";
    }

    private static String openingPeriod(long millis) {
        long day = 86_400_000L;
        return millis % day == 0 ? (millis / day) + (millis == day ? " real day" : " real days") : DurationSpec.formatMillis(millis);
    }

    private static int status(CommandSourceStack source, EndLockState.Domain domain) {
        EndLockState current = state(source.getServer());
        source.sendSuccess(() -> Component.literal(label(domain) + ": " + lockMessage(current, domain, System.currentTimeMillis())
                + (domain == END ? " Eye crafting blocked=" + current.eyeCraftingBlocked() + "; frame insertion blocked=" + current.frameInsertionBlocked() + "." : "")), false);
        return 1;
    }

    private static int change(CommandSourceStack source, EndLockState.Domain domain, boolean locked, String duration) {
        try {
            if (duration == null) state(source.getServer()).setLocked(domain, locked);
            else state(source.getServer()).lockFor(domain, DurationSpec.parseMillis(duration), System.currentTimeMillis());
            refreshMenus(source.getServer());
            source.sendSuccess(() -> Component.literal(lockMessage(state(source.getServer()), domain, System.currentTimeMillis())), false);
            return 1;
        } catch (IllegalArgumentException invalid) {
            source.sendFailure(Component.literal("Use a duration from 1s to 365d, such as 20s, 30m, 6h, 1d or 2d."));
            return 0;
        } catch (IOException failure) {
            source.sendFailure(Component.literal("Could not save dimension lock state; access remains locked. Check server storage."));
            LOGGER.error("Dimension lock state could not be saved", failure);
            return 0;
        }
    }

    private static int configureEye(CommandSourceStack source, boolean crafting, boolean blocked) {
        try {
            if (crafting) state(source.getServer()).setEyeCraftingBlocked(blocked);
            else state(source.getServer()).setFrameInsertionBlocked(blocked);
            refreshMenus(source.getServer());
            return status(source, END);
        } catch (IOException failure) {
            source.sendFailure(Component.literal("Could not save End configuration; check storage."));
            return 0;
        }
    }

    static void refreshMenus(MinecraftServer server) {
            // Refresh existing previews so a table open during /endlock on cannot retain its old output.
            for (var player : server.getPlayerList().getPlayers()) {
                player.inventoryMenu.slotsChanged(player.getInventory());
                player.inventoryMenu.broadcastFullState();
                player.containerMenu.slotsChanged(player.getInventory());
                player.containerMenu.broadcastFullState();
            }
    }
}
