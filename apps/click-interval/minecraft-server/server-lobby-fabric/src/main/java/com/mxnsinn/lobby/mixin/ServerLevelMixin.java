package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ServerLevel.class)
public abstract class ServerLevelMixin {
    @Inject(method = "addFreshEntity", at = @At("HEAD"), cancellable = true)
    private void lobby$noDroppedEntities(Entity entity, CallbackInfoReturnable<Boolean> cir) {
        if (LobbyPreviewGuard.active((ServerLevel) (Object) this) && LobbyPreviewGuard.prohibitedEntity(entity)) cir.setReturnValue(false);
    }
}
