package com.clickinterval.advancementsilence.mixin;

import com.clickinterval.advancementsilence.ServerAdvancementSilence;
import net.minecraft.network.chat.Component;
import net.minecraft.server.PlayerAdvancements;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.PlayerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(PlayerAdvancements.class)
abstract class AdvancementBroadcastMixin {
    @Shadow private ServerPlayer player;

    // Rewards and criterion progress are already granted; only this vanilla public-chat call is filtered.
    @Redirect(method = "lambda$award$0", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/server/players/PlayerList;broadcastSystemMessage(Lnet/minecraft/network/chat/Component;Z)V"))
    private void advancementSilence$filterAnnouncement(PlayerList players, Component message, boolean overlay) {
        if (!ServerAdvancementSilence.isSilenced(player)) players.broadcastSystemMessage(message, overlay);
    }
}
