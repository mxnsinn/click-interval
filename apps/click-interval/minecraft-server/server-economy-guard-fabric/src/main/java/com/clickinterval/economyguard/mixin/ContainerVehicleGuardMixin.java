package com.clickinterval.economyguard.mixin;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.vehicle.boat.AbstractChestBoat;
import net.minecraft.world.entity.vehicle.minecart.AbstractMinecartContainer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A transferred/unloaded source still holds its serialized inventory in memory.
 * Native container-vehicle remove drops that inventory before Entity notices it
 * was already removed. Never let a late callback materialize the stale copy.
 * This does not clear inventory, modify saves, or interfere with first removal. */
@Mixin({AbstractMinecartContainer.class, AbstractChestBoat.class})
abstract class ContainerVehicleGuardMixin {
    @Inject(method = "remove", at = @At("HEAD"), cancellable = true)
    private void economyGuard$removeOnce(Entity.RemovalReason reason, CallbackInfo ci) {
        Entity self = (Entity) (Object) this;
        if (!self.level().isClientSide() && self.isRemoved()) ci.cancel();
    }

    @Inject(method = "destroy(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/damagesource/DamageSource;)V",
            at = @At("HEAD"), cancellable = true)
    private void economyGuard$destroyOnce(ServerLevel level, DamageSource source, CallbackInfo ci) {
        if (((Entity) (Object) this).isRemoved()) ci.cancel();
    }
}
