package dev.serverdeathloot.fabric.mixin;

import dev.serverdeathloot.fabric.DeathDropMarker;
import dev.serverdeathloot.fabric.core.ExpiryPolicy;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ItemEntity.class)
abstract class ItemEntityMixin implements DeathDropMarker {
    @Unique
    private static final String SERVER_DEATH_LOOT_EXPIRY_KEY = "ServerDeathLootExpiresAt";

    @Unique
    private long serverDeathLoot$expiresAtMillis;

    @Override
    public void serverDeathLoot$setExpiry(long expiresAtMillis) {
        if (expiresAtMillis <= 0L) throw new IllegalArgumentException("expiry must be positive");
        serverDeathLoot$expiresAtMillis = expiresAtMillis;
        ((ItemEntity) (Object) this).setUnlimitedLifetime();
    }

    @Override
    public long serverDeathLoot$expiresAtMillis() {
        return serverDeathLoot$expiresAtMillis;
    }

    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void serverDeathLoot$expire(CallbackInfo callbackInfo) {
        ItemEntity self = (ItemEntity) (Object) this;
        long expiresAt = serverDeathLoot$expiresAtMillis;
        // The overwhelmingly common path (ordinary item entities) is one primitive comparison and
        // does not read the wall clock. Only marked player-death drops pay for the expiry check.
        if (expiresAt <= 0L || self.level().isClientSide()) return;
        if (ExpiryPolicy.isExpired(expiresAt, System.currentTimeMillis())) {
            self.discard();
            callbackInfo.cancel();
        }
    }

    @Inject(method = "addAdditionalSaveData", at = @At("TAIL"))
    private void serverDeathLoot$saveExpiry(ValueOutput output, CallbackInfo callbackInfo) {
        if (serverDeathLoot$expiresAtMillis > 0L) {
            output.putLong(SERVER_DEATH_LOOT_EXPIRY_KEY, serverDeathLoot$expiresAtMillis);
        }
    }

    @Inject(method = "readAdditionalSaveData", at = @At("TAIL"))
    private void serverDeathLoot$loadExpiry(ValueInput input, CallbackInfo callbackInfo) {
        long expiry = input.getLongOr(SERVER_DEATH_LOOT_EXPIRY_KEY, 0L);
        if (expiry > 0L) {
            serverDeathLoot$expiresAtMillis = expiry;
            ((ItemEntity) (Object) this).setUnlimitedLifetime();
        }
    }
}
