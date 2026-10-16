package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.*;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(ServerPlayer.class)
public abstract class ServerPlayerMixin {
    @Inject(method="hurtServer",at=@At("HEAD"),cancellable=true)
    private void protectTeam(ServerLevel level,DamageSource source,float damage,CallbackInfoReturnable<Boolean> ci){if(DamageAttribution.friendly((ServerPlayer)(Object)this,source))ci.setReturnValue(false);}
    @Inject(method="getTabListDisplayName",at=@At("HEAD"),cancellable=true)
    private void fullTeamName(CallbackInfoReturnable<Component> ci){if(ServerTeams.current()!=null){Component name=ServerTeams.current().tabName((ServerPlayer)(Object)this);if(name!=null)ci.setReturnValue(name);}}
}
