package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.SelectiveMobGriefing;
import net.minecraft.world.entity.monster.Creeper;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(Creeper.class)
abstract class CreeperExplosionMixin {
    @ModifyArg(
            method = "explodeCreeper",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/server/level/ServerLevel;explode(Lnet/minecraft/world/entity/Entity;DDDFLnet/minecraft/world/level/Level$ExplosionInteraction;)V"
            ),
            index = 5
    )
    private Level.ExplosionInteraction serverProtection$keepBlocksIntact(
            Level.ExplosionInteraction vanillaInteraction) {
        return SelectiveMobGriefing.creeperExplosionInteraction(vanillaInteraction);
    }
}
