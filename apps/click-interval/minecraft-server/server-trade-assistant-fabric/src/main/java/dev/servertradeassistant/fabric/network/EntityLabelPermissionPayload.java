package dev.servertradeassistant.fabric.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Server-authoritative capability state for the client-local entity label overlay. */
public record EntityLabelPermissionPayload(boolean allowed) implements CustomPacketPayload {
    public static final Type<EntityLabelPermissionPayload> TYPE =
            CustomPacketPayload.createType("servertradeassistant:entity_label_permission");
    public static final StreamCodec<RegistryFriendlyByteBuf, EntityLabelPermissionPayload> CODEC =
            StreamCodec.composite(ByteBufCodecs.BOOL, EntityLabelPermissionPayload::allowed,
                    EntityLabelPermissionPayload::new);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
