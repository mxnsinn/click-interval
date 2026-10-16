package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.DamageAttribution;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.effect.MobEffectCategory;
import net.minecraft.world.effect.MobEffectInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(LivingEntity.class)
public abstract class HarmfulEffectMixin {
    // Poison/wither lose their thrower's attribution on later ticks, so block the harmful application.
    // Beneficial potions and self-use are unchanged; unattributed world effects are unchanged.
    @Inject(method="addEffect(Lnet/minecraft/world/effect/MobEffectInstance;Lnet/minecraft/world/entity/Entity;)Z",at=@At("HEAD"),cancellable=true)
    private void protectEffect(MobEffectInstance effect,Entity source,CallbackInfoReturnable<Boolean> ci){if(effect.getEffect().value().getCategory()==MobEffectCategory.HARMFUL&&DamageAttribution.friendly((Entity)(Object)this,source))ci.setReturnValue(false);}
}
