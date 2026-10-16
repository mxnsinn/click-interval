package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyCommands;
import com.mxnsinn.lobby.LobbyPreviewGuard;
import com.mojang.brigadier.ParseResults;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Commands.class)
public abstract class CommandsMixin {
    @Inject(method = "performCommand", at = @At("HEAD"), cancellable = true)
    private void lobby$onlyCommunication(ParseResults<CommandSourceStack> parsed, String command, CallbackInfo ci) {
        if (parsed.getContext().getSource().getEntity() instanceof ServerPlayer player
                && LobbyPreviewGuard.active(player.level()) && !LobbyCommands.allowed(command)) {
            player.sendSystemMessage(Component.literal("That command is unavailable in the lobby."));
            ci.cancel();
        }
    }
}
