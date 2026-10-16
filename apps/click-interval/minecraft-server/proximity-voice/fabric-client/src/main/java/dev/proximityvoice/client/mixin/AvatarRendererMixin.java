package dev.proximityvoice.client.mixin;

import dev.proximityvoice.client.ProximityVoiceClient;
import dev.proximityvoice.client.core.VoiceRoster;
import net.minecraft.ChatFormatting;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Avatar;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(AvatarRenderer.class)
public abstract class AvatarRendererMixin {
    private static final FontDescription MICROPHONE_FONT = new FontDescription.Resource(
            Identifier.fromNamespaceAndPath(ProximityVoiceClient.MOD_ID, "microphone")
    );

    @Inject(
            method = "extractRenderState(Lnet/minecraft/world/entity/Avatar;Lnet/minecraft/client/renderer/entity/state/AvatarRenderState;F)V",
            at = @At("TAIL")
    )
    private void proximityVoice$appendMicrophoneState(Avatar avatar, AvatarRenderState state,
                                                       float partialTicks, CallbackInfo callback) {
        ProximityVoiceClient voice = ProximityVoiceClient.getInstance();
        if (voice == null || state.nameTag == null) return;
        VoiceRoster.Status status = voice.playerVoiceStatus(avatar.getUUID());
        ChatFormatting color = switch (status) {
            case SPEAKING -> ChatFormatting.GREEN;
            case MUTED -> ChatFormatting.RED;
            case IDLE -> ChatFormatting.GRAY;
            case DISCONNECTED -> ChatFormatting.DARK_GRAY;
        };
        String glyph = switch (status) {
            case SPEAKING -> "\uE001";
            case MUTED -> "\uE002";
            case IDLE -> "\uE003";
            case DISCONNECTED -> "\uE004";
        };
        Component microphone = Component.literal("  ").append(
                Component.literal(glyph)
                        .withStyle(style -> style.withColor(color).withFont(MICROPHONE_FONT))
        );
        state.nameTag = state.nameTag.copy().append(microphone);
    }
}
