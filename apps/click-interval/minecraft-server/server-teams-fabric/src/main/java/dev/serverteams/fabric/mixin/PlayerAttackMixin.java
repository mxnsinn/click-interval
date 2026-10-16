package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.DamageAttribution;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(Player.class)
public abstract class PlayerAttackMixin {
    @Inject(method="attack",at=@At("HEAD"),cancellable=true)
    private void protectAttack(Entity target,CallbackInfo ci){if(DamageAttribution.friendly(target,(Entity)(Object)this))ci.cancel();}
    @Inject(method="stabAttack",at=@At("HEAD"),cancellable=true)
    private void protectStab(EquipmentSlot slot,Entity target,float damage,boolean a,boolean b,boolean c,CallbackInfoReturnable<Boolean> ci){if(DamageAttribution.friendly(target,(Entity)(Object)this))ci.setReturnValue(false);}
}
