package dev.serverprotection.fabric.mixin;

import com.mojang.brigadier.ParseResults;
import dev.serverprotection.fabric.ServerProtectionFabric;
import dev.serverprotection.fabric.MovementCorrectionTracker;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.protocol.common.ServerboundClientInformationPacket;
import net.minecraft.network.protocol.game.ClientboundCommandSuggestionsPacket;
import net.minecraft.network.protocol.game.ServerboundAttackPacket;
import net.minecraft.network.protocol.game.ServerboundBlockEntityTagQueryPacket;
import net.minecraft.network.protocol.game.ServerboundContainerSlotStateChangedPacket;
import net.minecraft.network.protocol.game.ServerboundContainerButtonClickPacket;
import net.minecraft.network.protocol.game.ServerboundContainerClickPacket;
import net.minecraft.network.protocol.game.ServerboundContainerClosePacket;
import net.minecraft.network.protocol.game.ServerboundChangeDifficultyPacket;
import net.minecraft.network.protocol.game.ServerboundChangeGameModePacket;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.network.protocol.game.ServerboundCommandSuggestionPacket;
import net.minecraft.network.protocol.game.ServerboundDebugSubscriptionRequestPacket;
import net.minecraft.network.protocol.game.ServerboundEditBookPacket;
import net.minecraft.network.protocol.game.ServerboundEntityTagQueryPacket;
import net.minecraft.network.protocol.game.ServerboundInteractPacket;
import net.minecraft.network.protocol.game.ServerboundJigsawGeneratePacket;
import net.minecraft.network.protocol.game.ServerboundLockDifficultyPacket;
import net.minecraft.network.protocol.game.ServerboundMoveVehiclePacket;
import net.minecraft.network.protocol.game.ServerboundPickItemFromBlockPacket;
import net.minecraft.network.protocol.game.ServerboundPickItemFromEntityPacket;
import net.minecraft.network.protocol.game.ServerboundPlaceRecipePacket;
import net.minecraft.network.protocol.game.ServerboundRecipeBookChangeSettingsPacket;
import net.minecraft.network.protocol.game.ServerboundRecipeBookSeenRecipePacket;
import net.minecraft.network.protocol.game.ServerboundRenameItemPacket;
import net.minecraft.network.protocol.game.ServerboundSelectBundleItemPacket;
import net.minecraft.network.protocol.game.ServerboundSelectTradePacket;
import net.minecraft.network.protocol.game.ServerboundSetBeaconPacket;
import net.minecraft.network.protocol.game.ServerboundSetCommandBlockPacket;
import net.minecraft.network.protocol.game.ServerboundSetCommandMinecartPacket;
import net.minecraft.network.protocol.game.ServerboundSetCreativeModeSlotPacket;
import net.minecraft.network.protocol.game.ServerboundSetGameRulePacket;
import net.minecraft.network.protocol.game.ServerboundSetJigsawBlockPacket;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;
import net.minecraft.network.protocol.game.ServerboundAcceptTeleportationPacket;
import net.minecraft.network.protocol.game.ServerboundPaddleBoatPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerAbilitiesPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerInputPacket;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.network.protocol.game.ServerboundSetStructureBlockPacket;
import net.minecraft.network.protocol.game.ServerboundSetTestBlockPacket;
import net.minecraft.network.protocol.game.ServerboundSeenAdvancementsPacket;
import net.minecraft.network.protocol.game.ServerboundSignUpdatePacket;
import net.minecraft.network.protocol.game.ServerboundSpectatorActionPacket;
import net.minecraft.network.protocol.game.ServerboundTeleportToEntityPacket;
import net.minecraft.network.protocol.game.ServerboundTestInstanceBlockActionPacket;
import net.minecraft.network.protocol.game.ServerboundUseItemOnPacket;
import net.minecraft.network.protocol.game.ServerboundUseItemPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.entity.PositionMoveRotation;
import net.minecraft.world.entity.Relative;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Group;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;
import java.util.Set;

/** Applies the inventory-rate decision before vanilla mutates a container. */
@Mixin(ServerGamePacketListenerImpl.class)
abstract class ServerGamePacketListenerMixin {
    @Shadow public ServerPlayer player;
    @Shadow private Vec3 awaitingPositionFromClient;
    @Shadow private int awaitingTeleport;
    @Unique private final MovementCorrectionTracker serverProtection$corrections = new MovementCorrectionTracker();

    @Inject(method = "teleport(Lnet/minecraft/world/entity/PositionMoveRotation;Ljava/util/Set;)V", at = @At("TAIL"))
    private void serverProtection$recordIssuedCorrection(PositionMoveRotation position, Set<Relative> relatives, CallbackInfo callback) {
        if (awaitingPositionFromClient == null) { serverProtection$corrections.reset(); return; }
        serverProtection$corrections.issued(System.currentTimeMillis(), awaitingTeleport,
                awaitingPositionFromClient.x, awaitingPositionFromClient.y, awaitingPositionFromClient.z,
                player.getYRot(), player.getXRot());
    }

    @Inject(method = "handleAcceptTeleportPacket", at = @At("TAIL"))
    private void serverProtection$acceptedCorrection(ServerboundAcceptTeleportationPacket packet, CallbackInfo callback) {
        // The TAIL follows vanilla's validated ACK path, after it clears its pending position.
        // Unknown IDs still have a pending position; invalid duplicate ACKs return earlier.
        if (packet.getId() == awaitingTeleport && awaitingPositionFromClient == null)
            serverProtection$corrections.acknowledged(System.currentTimeMillis(), packet.getId());
    }

    /*
     * POV input is rejected authoritatively on receipt. The active-viewer lookup is backed by a
     * concurrent set, so these HEAD injections are safe before PacketUtils moves normal packets to
     * the server thread. Chat, commands, chat acknowledgements, teleport acknowledgements,
     * keep-alives, and custom payloads are deliberately not intercepted.
     */
    @Inject(method = "handleMovePlayer", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovMove(ServerboundMovePlayerPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePlayerInput", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovInput(ServerboundPlayerInputPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleMoveVehicle", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovVehicleMove(ServerboundMoveVehiclePacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePaddleBoat", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovPaddle(ServerboundPaddleBoatPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleUseItemOn", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovUseOn(ServerboundUseItemOnPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleUseItem", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovUse(ServerboundUseItemPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleInteract", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovInteract(ServerboundInteractPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleTeleportToEntityPacket", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovTeleportToEntity(ServerboundTeleportToEntityPacket packet,
                                                            CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetCarriedItem", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovHeldSlot(ServerboundSetCarriedItemPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePlayerCommand", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovPlayerCommand(ServerboundPlayerCommandPacket packet,
                                                         CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePlayerAbilities", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovAbilities(ServerboundPlayerAbilitiesPacket packet,
                                                     CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleRecipeBookSeenRecipePacket", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovRecipeSeen(ServerboundRecipeBookSeenRecipePacket packet,
                                                       CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleRecipeBookChangeSettingsPacket", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovRecipeSettings(ServerboundRecipeBookChangeSettingsPacket packet,
                                                           CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSeenAdvancements", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovAdvancements(ServerboundSeenAdvancementsPacket packet,
                                                        CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetCommandBlock", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovCommandBlock(ServerboundSetCommandBlockPacket packet,
                                                        CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetCommandMinecart", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovCommandMinecart(ServerboundSetCommandMinecartPacket packet,
                                                           CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetGameRule", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovGameRule(ServerboundSetGameRulePacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetStructureBlock", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovStructure(ServerboundSetStructureBlockPacket packet,
                                                     CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetTestBlock", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovTestBlock(ServerboundSetTestBlockPacket packet,
                                                     CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleTestInstanceBlockAction", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovTestAction(ServerboundTestInstanceBlockActionPacket packet,
                                                      CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetJigsawBlock", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovJigsaw(ServerboundSetJigsawBlockPacket packet,
                                                  CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleJigsawGenerate", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovJigsawGenerate(ServerboundJigsawGeneratePacket packet,
                                                          CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleEntityTagQuery", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovEntityQuery(ServerboundEntityTagQueryPacket packet,
                                                       CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleBlockEntityTagQuery", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovBlockEntityQuery(ServerboundBlockEntityTagQueryPacket packet,
                                                            CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = {"handleAnimate", "handlePunch"}, at = @At("HEAD"), cancellable = true, require = 1)
    private void serverProtection$blockPovArmAction(CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSpectatorAction", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovSpectatorAction(ServerboundSpectatorActionPacket packet,
                                                           CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleClientCommand", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovClientCommand(ServerboundClientCommandPacket packet,
                                                         CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleContainerClose", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovContainerClose(ServerboundContainerClosePacket packet,
                                                          CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleClientInformation", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovClientInformation(ServerboundClientInformationPacket packet,
                                                             CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleChangeDifficulty", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovDifficulty(ServerboundChangeDifficultyPacket packet,
                                                      CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleChangeGameMode", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovGameMode(ServerboundChangeGameModePacket packet,
                                                    CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleLockDifficulty", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovDifficultyLock(ServerboundLockDifficultyPacket packet,
                                                          CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleDebugSubscriptionRequest", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovDebugSubscription(ServerboundDebugSubscriptionRequestPacket packet,
                                                             CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    // 26.2 resolves suggestions inline after moving the packet onto the server thread.
    @Group(name = "serverProtection$commandSuggestions", min = 1, max = 1)
    @Inject(method = "handleCustomCommandSuggestions", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true, require = 0)
    private void serverProtection$filterCommandSuggestions26_2(ServerboundCommandSuggestionPacket packet,
                                                                CallbackInfo callback) {
        serverProtection$filterCommandSuggestions(packet, callback);
    }

    // 26.3's provider queues the actual dispatcher access for its server-thread tick. The policy
    // predicate below is deliberately snapshot-only, so a denied request can be dropped before it
    // enters that queue without reading mutable dispatcher/player-world state on the Netty thread.
    @Group(name = "serverProtection$commandSuggestions", min = 1, max = 1)
    @Inject(method = "handleCustomCommandSuggestions", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/server/network/ServerCommandSuggestionsProvider;request(Ljava/lang/String;)Ljava/util/concurrent/CompletableFuture;"),
            cancellable = true, require = 0)
    private void serverProtection$filterCommandSuggestions26_3(ServerboundCommandSuggestionPacket packet,
                                                                CallbackInfo callback) {
        serverProtection$filterCommandSuggestions(packet, callback);
    }

    private void serverProtection$filterCommandSuggestions(ServerboundCommandSuggestionPacket packet,
                                                             CallbackInfo callback) {
        CommandSuggestionPacketAccessor accessor = (CommandSuggestionPacketAccessor) (Object) packet;
        if (ServerProtectionFabric.handleSharedTeamSuggestions(player,
                accessor.serverProtection$suggestionId(), accessor.serverProtection$command())) {
            callback.cancel();
            return;
        }
        if (ServerProtectionFabric.allowCommandSuggestions(player, accessor.serverProtection$command())) return;
        player.connection.send(new ClientboundCommandSuggestionsPacket(
                accessor.serverProtection$suggestionId(), 0, 0, List.of()));
        callback.cancel();
    }

    @Inject(method = "handleAttack", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovAttack(ServerboundAttackPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePlayerAction", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovPlayerAction(ServerboundPlayerActionPacket packet,
                                                        CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleContainerClick", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovContainerClick(ServerboundContainerClickPacket packet,
                                                          CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleContainerButtonClick", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovContainerButton(ServerboundContainerButtonClickPacket packet,
                                                           CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetCreativeModeSlot", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovCreativeSlot(ServerboundSetCreativeModeSlotPacket packet,
                                                        CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePickItemFromBlock", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovPickBlock(ServerboundPickItemFromBlockPacket packet,
                                                     CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePickItemFromEntity", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovPickEntity(ServerboundPickItemFromEntityPacket packet,
                                                      CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleBundleItemSelectedPacket", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovBundleSelection(ServerboundSelectBundleItemPacket packet,
                                                           CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handlePlaceRecipe", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovRecipe(ServerboundPlaceRecipePacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSelectTrade", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovTrade(ServerboundSelectTradePacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleRenameItem", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovRename(ServerboundRenameItemPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSetBeaconPacket", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovBeacon(ServerboundSetBeaconPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleEditBook", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovBook(ServerboundEditBookPacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleContainerSlotStateChanged", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovSlotState(ServerboundContainerSlotStateChangedPacket packet,
                                                     CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    @Inject(method = "handleSignUpdate", at = @At("HEAD"), cancellable = true)
    private void serverProtection$blockPovSign(ServerboundSignUpdatePacket packet, CallbackInfo callback) {
        serverProtection$cancelPovGameplay(callback);
    }

    private void serverProtection$cancelPovGameplay(CallbackInfo callback) {
        if (ServerProtectionFabric.isPlayerViewActive(player)) callback.cancel();
    }

    @Inject(method = "handleMovePlayer", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER))
    private void serverProtection$movementPacket(ServerboundMovePlayerPacket packet, CallbackInfo callback) {
        boolean correctionResponse = serverProtection$corrections.consume(System.currentTimeMillis(),
                packet instanceof ServerboundMovePlayerPacket.PosRot, packet.isOnGround(), packet.horizontalCollision(),
                packet.getX(Double.NaN), packet.getY(Double.NaN), packet.getZ(Double.NaN),
                packet.getYRot(Float.NaN), packet.getXRot(Float.NaN));
        ServerProtectionFabric.observeMovementPacket(player, correctionResponse);
    }

    @Inject(method = "handleAttack", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverProtection$attackAttempt(ServerboundAttackPacket packet, CallbackInfo callback) {
        if (!ServerProtectionFabric.allowAttackPacket(player, packet.entityId())) callback.cancel();
    }

    @Inject(method = "handlePlayerAction", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverProtection$blockBreakAttempt(ServerboundPlayerActionPacket packet,
                                                     CallbackInfo callback) {
        if (packet.getAction() == ServerboundPlayerActionPacket.Action.START_DESTROY_BLOCK
                && !ServerProtectionFabric.allowBlockInteractionPacket(player, packet.getPos(), false)) {
            callback.cancel();
        }
    }

    @Inject(method = "handleContainerClick", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverProtection$inventoryClick(ServerboundContainerClickPacket packet, CallbackInfo callback) {
        boolean helperCompatible = (packet.containerInput() == ContainerInput.QUICK_MOVE
                || packet.containerInput() == ContainerInput.QUICK_CRAFT)
                && packet.containerId() == player.containerMenu.containerId
                && packet.slotNum() >= -1
                && packet.slotNum() < player.containerMenu.slots.size();
        if (ServerProtectionFabric.allowInventoryClick(player, helperCompatible)) return;
        callback.cancel();
    }

    @Inject(method = "handleContainerButtonClick", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverProtection$containerButton(ServerboundContainerButtonClickPacket packet,
                                                     CallbackInfo callback) {
        if (!ServerProtectionFabric.allowInventoryClick(player, false)) callback.cancel();
    }

    @Inject(method = "handleSetCreativeModeSlot", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverProtection$creativeInventory(ServerboundSetCreativeModeSlotPacket packet,
                                                       CallbackInfo callback) {
        if (!ServerProtectionFabric.allowInventoryClick(player, false)) callback.cancel();
    }

    @Inject(method = "performUnsignedChatCommand", at = @At("HEAD"), cancellable = true)
    private void serverProtection$unsignedCommand(String command, CallbackInfo callback) {
        if (ServerProtectionFabric.handleCommand(player, command)) callback.cancel();
    }

    /**
     * Signed commands must reach vanilla's argument decoder before access policy is applied.
     * Cancelling performSignedChatCommand at HEAD skips that decoder and permanently breaks the
     * player's secure-chat chain after commands such as /msg, /tell, and /w.
     */
    @Redirect(method = "performSignedChatCommand", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/server/network/ServerGamePacketListenerImpl;parseCommand(Ljava/lang/String;)Lcom/mojang/brigadier/ParseResults;"))
    private ParseResults<CommandSourceStack> serverProtection$parseSignedCommand(
            ServerGamePacketListenerImpl listener, String command) {
        return ServerProtectionFabric.parseSignedCommand(player, command);
    }

    @Redirect(method = "performSignedChatCommand", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/commands/Commands;performCommand(Lcom/mojang/brigadier/ParseResults;Ljava/lang/String;)V"))
    private void serverProtection$signedCommand(Commands commands,
                                                  ParseResults<CommandSourceStack> parsedCommand,
                                                  String command) {
        ServerProtectionFabric.performSignedCommand(player, commands, parsedCommand, command);
    }
}
