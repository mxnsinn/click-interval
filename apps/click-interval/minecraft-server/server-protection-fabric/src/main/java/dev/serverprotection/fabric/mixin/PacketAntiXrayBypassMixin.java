package dev.serverprotection.fabric.mixin;

import com.meowantixray.antixray.FakeOreService;
import dev.serverprotection.fabric.ServerProtectionFabric;
import net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Makes the explicit per-player anti-cheat switch cover packet Anti-Xray as well. */
@Mixin(value = FakeOreService.class, remap = false)
abstract class PacketAntiXrayBypassMixin {
    @Inject(method = "sendChunkPacket", at = @At("HEAD"), cancellable = true, remap = false)
    private void serverProtection$bypassForExplicitExemption(
            ServerGamePacketListenerImpl connection,
            ServerLevel level,
            LevelChunk chunk,
            ClientboundLevelChunkWithLightPacket packet,
            CallbackInfo callback) {
        if (!ServerProtectionFabric.isPacketAntiXrayExempt(connection.player)) return;
        connection.send(packet);
        callback.cancel();
    }
}
