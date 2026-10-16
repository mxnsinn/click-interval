package com.clickinterval.endlock.mixin;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Vanilla's persisted Overworld departure point, including trips made before this mod was installed. */
@Mixin(ServerPlayer.class)
public interface ServerPlayerOriginAccessor {
    @Accessor("enteredNetherPosition")
    Vec3 serverEndLock$getEnteredNetherPosition();
}
