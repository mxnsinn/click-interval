package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.DamageAttribution;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.damagesource.DamageSource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(LivingEntity.class)
public abstract class LivingKnockbackMixin {
    @Inject(method="knockback(DDDLnet/minecraft/world/damagesource/DamageSource;FZ)V",at=@At("HEAD"),cancellable=true)
    private void protectKnockback(double power,double x,double z,DamageSource source,float damage,boolean hurt,CallbackInfo ci){if((Object)this instanceof ServerPlayer p&&source!=null&&DamageAttribution.friendly(p,source))ci.cancel();}
}
