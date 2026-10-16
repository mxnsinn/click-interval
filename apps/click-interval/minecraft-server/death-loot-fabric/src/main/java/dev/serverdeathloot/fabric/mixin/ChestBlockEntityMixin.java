package dev.serverdeathloot.fabric.mixin;

import dev.serverdeathloot.fabric.DeathChestMarker;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.UUID;

@Mixin(ChestBlockEntity.class)
abstract class ChestBlockEntityMixin implements DeathChestMarker {
    @Unique
    private static final String SERVER_DEATH_LOOT_ID_KEY = "ServerDeathLootId";
    @Unique
    private static final String SERVER_DEATH_LOOT_EXPIRY_KEY = "ServerDeathLootExpiresAt";

    @Unique
    private String serverDeathLoot$deathId;
    @Unique
    private long serverDeathLoot$expiresAtMillis;

    @Override
    public void serverDeathLoot$mark(String deathId, long expiresAtMillis) {
        if (deathId == null) throw new IllegalArgumentException("deathId is required");
        String normalized = UUID.fromString(deathId).toString();
        if (expiresAtMillis < 0L) throw new IllegalArgumentException("expiry cannot be negative");
        serverDeathLoot$deathId = normalized;
        serverDeathLoot$expiresAtMillis = expiresAtMillis;
        ((ChestBlockEntity) (Object) this).setChanged();
    }

    @Override
    public String serverDeathLoot$deathId() {
        return serverDeathLoot$deathId;
    }

    @Override
    public long serverDeathLoot$expiresAtMillis() {
        return serverDeathLoot$expiresAtMillis;
    }

    @Inject(method = "saveAdditional", at = @At("TAIL"))
    private void serverDeathLoot$saveMarker(ValueOutput output, CallbackInfo callbackInfo) {
        if (serverDeathLoot$deathId == null) return;
        output.putString(SERVER_DEATH_LOOT_ID_KEY, serverDeathLoot$deathId);
        output.putLong(SERVER_DEATH_LOOT_EXPIRY_KEY, serverDeathLoot$expiresAtMillis);
    }

    @Inject(method = "loadAdditional", at = @At("TAIL"))
    private void serverDeathLoot$loadMarker(ValueInput input, CallbackInfo callbackInfo) {
        String rawId = input.getStringOr(SERVER_DEATH_LOOT_ID_KEY, "");
        if (rawId.isBlank()) return;
        try {
            serverDeathLoot$deathId = UUID.fromString(rawId).toString();
            serverDeathLoot$expiresAtMillis = Math.max(0L,
                    input.getLongOr(SERVER_DEATH_LOOT_EXPIRY_KEY, 0L));
        } catch (IllegalArgumentException ignored) {
            serverDeathLoot$deathId = null;
            serverDeathLoot$expiresAtMillis = 0L;
        }
    }
}
