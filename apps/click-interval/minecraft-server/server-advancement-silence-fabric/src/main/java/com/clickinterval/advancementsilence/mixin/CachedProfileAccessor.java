package com.clickinterval.advancementsilence.mixin;

import java.util.Date;
import net.minecraft.server.players.NameAndId;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(targets = "net.minecraft.server.players.CachedUserNameToIdResolver$GameProfileInfo")
public interface CachedProfileAccessor {
    @Accessor("nameAndId") NameAndId advancementSilence$identity();
    @Accessor("expirationDate") Date advancementSilence$expiration();
}
