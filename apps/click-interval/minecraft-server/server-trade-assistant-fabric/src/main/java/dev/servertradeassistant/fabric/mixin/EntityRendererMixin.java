package dev.servertradeassistant.fabric.mixin;

import dev.servertradeassistant.fabric.client.EntityIdOverlay;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityAttachment;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Adds a stable, nearby-only identifier without changing shared entity names. */
@Mixin(EntityRenderer.class)
public abstract class EntityRendererMixin {
    @Inject(
            method = "extractNameTags(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/client/renderer/entity/state/EntityRenderState;F)V",
            at = @At("TAIL")
    )
    private void tradeAssistant$appendEntityId(Entity entity, EntityRenderState state,
            float partialTick, CallbackInfo callback) {
        if (!EntityIdOverlay.visible() || entity == Minecraft.getInstance().player
                || state.distanceToCameraSq > EntityIdOverlay.MAX_DISTANCE_SQUARED) {
            return;
        }

        String compactUuid = entity.getUUID().toString().replace("-", "");
        String stableId = "#" + compactUuid.substring(compactUuid.length() - 8).toUpperCase();
        Component id = Component.literal(stableId).withStyle(ChatFormatting.DARK_GRAY);
        state.nameTag = state.nameTag == null
                ? id
                : state.nameTag.copy().append(Component.literal("  ")).append(id);
        if (state.nameTagAttachment == null) {
            state.nameTagAttachment = entity.getAttachments()
                    .getNullable(EntityAttachment.NAME_TAG, 0, entity.getYRot(partialTick));
        }
    }
}
