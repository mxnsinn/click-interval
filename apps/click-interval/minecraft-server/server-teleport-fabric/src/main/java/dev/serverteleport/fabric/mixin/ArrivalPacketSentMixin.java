package dev.serverteleport.fabric.mixin;

import dev.serverteleport.fabric.ServerTeleportFabric;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import io.netty.channel.ChannelFutureListener;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundForgetLevelChunkPacket;
import net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket;
import net.minecraft.network.protocol.game.ClientboundRespawnPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import java.util.LinkedHashMap;

/** Observe actual queued packets, including async Anti-Xray rewrites, not sender bookkeeping. */
@Mixin(ServerCommonPacketListenerImpl.class)
abstract class ArrivalPacketSentMixin {
    @Shadow @Final protected MinecraftServer server;
    @Unique private long serverteleport$terrainGeneration;
    @Unique private final LinkedHashMap<Long, Object> serverteleport$pendingWrites = new LinkedHashMap<>();

    @WrapOperation(method = "send(Lnet/minecraft/network/protocol/Packet;Lio/netty/channel/ChannelFutureListener;)V",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/network/Connection;send(Lnet/minecraft/network/protocol/Packet;Lio/netty/channel/ChannelFutureListener;Z)V"))
    private void serverteleport$recordSentTerrain(Connection network, Packet<?> packet,
                                                ChannelFutureListener listener, boolean flush,
                                                Operation<Void> original) {
        if (!((Object) this instanceof ServerGamePacketListenerImpl game)
                || !(packet instanceof ClientboundLevelChunkWithLightPacket
                || packet instanceof ClientboundForgetLevelChunkPacket || packet instanceof ClientboundRespawnPacket)) {
            original.call(network, packet, listener, flush);
            return;
        }
        // Mods may finish rewriting a chunk off-thread. Move the entire observed send to
        // the server thread before reading player/world state or taking a dimension stamp.
        if (!server.isSameThread()) {
            server.execute(() -> serverteleport$recordSentTerrain(network, packet, listener, flush, original));
            return;
        }
        ServerPlayer player = game.player;
        ServerLevel level = player.level();
        if (!(packet instanceof ClientboundLevelChunkWithLightPacket)) {
            if (packet instanceof ClientboundRespawnPacket) {
                serverteleport$terrainGeneration++;
                serverteleport$pendingWrites.clear();
            } else if (packet instanceof ClientboundForgetLevelChunkPacket forgotten) {
                serverteleport$pendingWrites.remove(forgotten.pos().pack());
            }
            ServerTeleportFabric.onOutgoingTerrainPacket(game, packet, level);
            original.call(network, packet, listener, flush);
            return;
        }
        ClientboundLevelChunkWithLightPacket chunk = (ClientboundLevelChunkWithLightPacket) packet;
        long chunkKey = ChunkPos.pack(chunk.getX(), chunk.getZ());
        Object writeToken = new Object();
        serverteleport$pendingWrites.put(chunkKey, writeToken);
        while (serverteleport$pendingWrites.size() > 8_192) serverteleport$pendingWrites.pollFirstEntry();
        long generation = serverteleport$terrainGeneration;
        ChannelFutureListener observed = future -> {
            server.execute(() -> {
                if (generation == serverteleport$terrainGeneration && game.player == player
                        && serverteleport$pendingWrites.get(chunkKey) == writeToken) {
                    serverteleport$pendingWrites.remove(chunkKey);
                    if (!future.isSuccess()) return;
                    ServerTeleportFabric.onOutgoingTerrainPacket(game, packet, level);
                }
            });
            if (listener != null) listener.operationComplete(future);
        };
        original.call(network, packet, observed, flush);
    }
}
