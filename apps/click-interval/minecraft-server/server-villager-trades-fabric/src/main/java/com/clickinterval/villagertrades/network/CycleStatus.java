package com.clickinterval.villagertrades.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

public record CycleStatus(int containerId, long nonce, boolean eligible) implements CustomPacketPayload {
    public static final Type<CycleStatus> TYPE = new Type<>(Identifier.fromNamespaceAndPath("server_villager_trades", "status_v1"));
    public static final StreamCodec<RegistryFriendlyByteBuf, CycleStatus> CODEC = CustomPacketPayload.codec(
            (value, buffer) -> { buffer.writeVarInt(value.containerId); buffer.writeLong(value.nonce); buffer.writeBoolean(value.eligible); },
            buffer -> new CycleStatus(buffer.readVarInt(), buffer.readLong(), buffer.readBoolean()));
    @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
