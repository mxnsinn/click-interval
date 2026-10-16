package dev.serverprotection.client.mixin;

import dev.serverprotection.client.ChatMentionHighlighter;
import dev.serverprotection.client.MentionContextClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ChatComponent.class)
public abstract class ChatMentionMixin {
    // Only change the displayed component; the signature, source, tag, and normal delivery stay intact.
    @ModifyVariable(method = "addPlayerMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V",
            at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private Component serverProtection$highlightOwnMention(Component message) {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null) return message;
        return ChatMentionHighlighter.highlight(message, client.player.getGameProfile().name(), MentionContextClient.ownTeamNames());
    }
}
