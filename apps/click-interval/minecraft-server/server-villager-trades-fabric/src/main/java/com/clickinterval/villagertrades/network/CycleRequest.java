package com.clickinterval.villagertrades.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Bounded, versioned request: no client-supplied entity, offers, items, or prices. */
public record CycleRequest(int containerId, long nonce, boolean cycle) implements CustomPacketPayload {
    public static final Type<CycleRequest> TYPE = new Type<>(Identifier.fromNamespaceAndPath("server_villager_trades", "cycle_v1"));
    public static final StreamCodec<RegistryFriendlyByteBuf, CycleRequest> CODEC = CustomPacketPayload.codec(
            (value, buffer) -> { buffer.writeVarInt(value.containerId); buffer.writeLong(value.nonce); buffer.writeBoolean(value.cycle); },
            buffer -> new CycleRequest(buffer.readVarInt(), buffer.readLong(), buffer.readBoolean()));
    @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
