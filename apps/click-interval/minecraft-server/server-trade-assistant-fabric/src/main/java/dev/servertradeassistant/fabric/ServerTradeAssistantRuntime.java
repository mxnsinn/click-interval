package dev.servertradeassistant.fabric;

import dev.servertradeassistant.fabric.access.RoleAccessPolicy;
import dev.servertradeassistant.fabric.access.RoleAccessResolver;
import dev.servertradeassistant.fabric.config.TradeAssistantConfig;
import dev.servertradeassistant.fabric.control.AppControlBridge;
import dev.servertradeassistant.fabric.core.CooldownGate;
import dev.servertradeassistant.fabric.core.RerollEligibility;
import dev.servertradeassistant.fabric.core.VillagerTradeState;
import dev.servertradeassistant.fabric.mixin.MerchantMenuAccessor;
import dev.servertradeassistant.fabric.network.EntityLabelPermissionPayload;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.ChatFormatting;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerProfession;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.Merchant;
import net.minecraft.world.item.trading.MerchantOffers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Server-authoritative trade cycling and session-scoped pricing. */
public final class ServerTradeAssistantRuntime {
    public static final int CYCLE_BUTTON_ID = 0x5441;
    private static final Logger LOGGER = LoggerFactory.getLogger("servertradeassistant");
    private static volatile ServerTradeAssistantRuntime active;

    private final TradeAssistantConfig config;
    private final RoleAccessResolver roleAccess;
    private final CooldownGate cooldowns = new CooldownGate();
    private final AppControlBridge appControl;
    private final Map<UUID, Boolean> entityLabelPermissions = new ConcurrentHashMap<>();

    private ServerTradeAssistantRuntime(TradeAssistantConfig config, RoleAccessResolver roleAccess,
            AppControlBridge appControl) {
        this.config = config;
        this.roleAccess = roleAccess;
        this.appControl = appControl;
    }

    public static synchronized ServerTradeAssistantRuntime initialize() {
        if (active != null) return active;
        Path configRoot = FabricLoader.getInstance().getConfigDir().toAbsolutePath().normalize();
        TradeAssistantConfig loaded;
        try {
            loaded = TradeAssistantConfig.load(configRoot.resolve("trade-assistant.properties"));
        } catch (IOException error) {
            loaded = TradeAssistantConfig.defaults();
            LOGGER.error("Could not load Trade Assistant config; using bounded defaults", error);
        }
        Path accessFile = configRoot.resolve(loaded.accessPolicyPath()).normalize();
        if (!accessFile.startsWith(configRoot)) accessFile = configRoot.resolve(TradeAssistantConfig.DEFAULT_ACCESS_POLICY);
        active = new ServerTradeAssistantRuntime(loaded, new RoleAccessResolver(accessFile, LOGGER),
                new AppControlBridge(configRoot.resolve("servertradeassistant"), LOGGER));
        LOGGER.info("Server Trade Assistant ready: cooldown={} ms, max rerolls={}, role gate={}",
                loaded.cooldownMillis(), loaded.maxRerollsPerVillager(), loaded.requireRolePermission());
        return active;
    }

    public static ServerTradeAssistantRuntime active() {
        ServerTradeAssistantRuntime instance = active;
        return instance == null ? initialize() : instance;
    }

    public TradeAssistantConfig config() {
        return config;
    }

    public void forgetPlayer(ServerPlayer player) {
        if (player != null) {
            cooldowns.forget(player.getUUID());
            entityLabelPermissions.remove(player.getUUID());
        }
    }

    public boolean hasCapability(ServerPlayer player, String capability) {
        return player != null && roleAccess.hasCapability(
                player.getGameProfile().name(), player.getUUID(), capability);
    }

    public void serverStarted(MinecraftServer server) {
        entityLabelPermissions.clear();
        if (config.appControlEnabled()) appControl.start(server);
    }

    public void serverStopped() {
        entityLabelPermissions.clear();
        appControl.stop();
    }

    public void serverTick(MinecraftServer server) {
        if (config.appControlEnabled()) appControl.tick(server);
        if (server.getTickCount() % 100 == 0) {
            for (ServerPlayer player : server.getPlayerList().getPlayers()) {
                refreshEntityLabelPermission(player, false);
            }
        }
    }

    public void refreshEntityLabelPermission(ServerPlayer player, boolean force) {
        if (player == null || !ServerPlayNetworking.canSend(player, EntityLabelPermissionPayload.TYPE)) return;
        boolean allowed = hasCapability(player, "entity.labels");
        Boolean previous = entityLabelPermissions.put(player.getUUID(), allowed);
        if (force || previous == null || previous.booleanValue() != allowed) {
            ServerPlayNetworking.send(player, new EntityLabelPermissionPayload(allowed));
        }
    }

    public void applySessionDiscount(Villager villager, Player player) {
        if (villager == null || player == null || villager.level().isClientSide()) return;
        RoleAccessPolicy.Decision decision = roleAccess.decide(
                player.getGameProfile().name(), player.getUUID(),
                config.requireRolePermission(), config.defaultTradeDiscountPercent());
        VillagerTradeState.of(villager).tradeAssistant$applyRoleDiscount(decision.tradeDiscountPercent());
    }

    public boolean tryCycleTrades(Player player, MerchantMenu menu) {
        if (!(player instanceof ServerPlayer serverPlayer)) return false;
        Merchant trader = ((MerchantMenuAccessor) menu).tradeAssistant$trader();
        if (!(trader instanceof Villager villager)) {
            deny(serverPlayer, "Only employed villagers can cycle trades.");
            return true;
        }
        if (serverPlayer.containerMenu != menu || trader.getTradingPlayer() != serverPlayer
                || !menu.stillValid(serverPlayer) || !villager.isAlive()) {
            deny(serverPlayer, "That villager is no longer available.");
            return true;
        }
        double maximumDistanceSquared = config.maximumDistanceBlocks() * config.maximumDistanceBlocks();
        if (serverPlayer.distanceToSqr(villager) > maximumDistanceSquared) {
            deny(serverPlayer, "Move closer to the villager.");
            return true;
        }

        RoleAccessPolicy.Decision access = roleAccess.decide(
                serverPlayer.getGameProfile().name(), serverPlayer.getUUID(),
                config.requireRolePermission(), config.defaultTradeDiscountPercent());
        if (!access.rerollAllowed()) {
            deny(serverPlayer, "Your role does not allow trade cycling.");
            return true;
        }

        long cooldownRemaining = cooldowns.remainingMillis(serverPlayer.getUUID());
        if (cooldownRemaining > 0L) {
            deny(serverPlayer, String.format(Locale.ROOT,
                    "Wait %.1fs before cycling again.", cooldownRemaining / 1000.0D));
            return true;
        }

        Holder<VillagerProfession> profession = villager.getVillagerData().profession();
        boolean employed = !profession.is(VillagerProfession.NONE) && !profession.is(VillagerProfession.NITWIT);
        String professionId = profession.unwrapKey()
                .map(key -> key.identifier().toString())
                .orElse("unregistered");
        VillagerTradeState tradeState = VillagerTradeState.of(villager);
        tradeState.tradeAssistant$prepareProfession(professionId);
        MerchantOffers currentOffers = villager.getOffers();
        RerollEligibility.Denial denial = RerollEligibility.evaluate(
                employed,
                villager.getVillagerData().level(),
                villager.getVillagerXp(),
                currentOffers.stream().anyMatch(offer -> offer.getUses() > 0),
                tradeState.tradeAssistant$rerollCount(),
                config.maxRerollsPerVillager());
        if (denial != RerollEligibility.Denial.NONE) {
            deny(serverPlayer, denialMessage(denial));
            return true;
        }

        cooldowns.arm(serverPlayer.getUUID(), config.cooldownMillis());
        MerchantOffers previousOffers = currentOffers;
        tradeState.tradeAssistant$removeRoleDiscount();
        returnPayment(menu, serverPlayer);
        try {
            villager.setOffers(new MerchantOffers());
            tradeState.tradeAssistant$regenerateTrades(serverPlayer.level());
            MerchantOffers generated = villager.getOffers();
            if (generated.isEmpty()) throw new IllegalStateException("Villager generated no offers");
            tradeState.tradeAssistant$applyVanillaPrices(serverPlayer);
            tradeState.tradeAssistant$applyRoleDiscount(access.tradeDiscountPercent());
            int rerollCount = tradeState.tradeAssistant$incrementRerollCount();
            syncOffers(serverPlayer, menu, villager, generated);
            int maximum = config.maxRerollsPerVillager();
            String suffix = maximum > 0 ? " (" + rerollCount + "/" + maximum + ")" : "";
            serverPlayer.sendOverlayMessage(Component.literal("Trades cycled" + suffix + ".")
                    .withStyle(ChatFormatting.GREEN));
        } catch (RuntimeException error) {
            villager.setOffers(previousOffers);
            tradeState.tradeAssistant$applyRoleDiscount(access.tradeDiscountPercent());
            syncOffers(serverPlayer, menu, villager, previousOffers);
            LOGGER.error("Trade reroll failed for villager {} and player {}",
                    villager.getUUID(), serverPlayer.getGameProfile().name(), error);
            deny(serverPlayer, "The trades could not be cycled. Your items were returned.");
        }
        return true;
    }

    private static void returnPayment(MerchantMenu menu, ServerPlayer player) {
        for (int slotIndex = 0; slotIndex <= 1; slotIndex++) {
            ItemStack payment = menu.getSlot(slotIndex).remove(Integer.MAX_VALUE);
            if (!payment.isEmpty()) player.getInventory().placeItemBackInInventory(payment);
        }
        menu.setSelectionHint(0);
        menu.broadcastFullState();
    }

    private static void syncOffers(ServerPlayer player, MerchantMenu menu, Villager villager,
            MerchantOffers offers) {
        menu.setSelectionHint(0);
        menu.broadcastFullState();
        player.sendMerchantOffers(menu.containerId, offers,
                villager.getVillagerData().level(), villager.getVillagerXp(),
                villager.showProgressBar(), villager.canRestock());
    }

    private static String denialMessage(RerollEligibility.Denial denial) {
        return switch (denial) {
            case NOT_EMPLOYED -> "This villager needs a profession before its trades can be cycled.";
            case NOT_NOVICE -> "Only novice villagers with no trade experience can cycle trades.";
            case ALREADY_TRADED -> "This villager has already been traded with, so its trades are locked.";
            case LIMIT_REACHED -> "This villager has reached its trade-cycle limit.";
            case NONE -> "This villager cannot cycle trades.";
        };
    }

    private static void deny(ServerPlayer player, String message) {
        player.sendOverlayMessage(Component.literal(message).withStyle(ChatFormatting.RED));
    }
}
