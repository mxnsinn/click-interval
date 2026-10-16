package com.clickinterval.chat.protocol;

import java.util.List;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Recipient's own team aliases only. No chat content, roster UUIDs, commands, or client-to-server channel. */
public record MentionContextPayload(List<String> names) implements CustomPacketPayload {
    public static final int MAX_NAMES = 64;
    public static final Type<MentionContextPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath("serverchat", "mention_context"));
    public static final StreamCodec<RegistryFriendlyByteBuf, MentionContextPayload> CODEC =
            CustomPacketPayload.codec(MentionContextPayload::write, MentionContextPayload::read);
    private static boolean registered;

    public MentionContextPayload {
        if (names == null || names.size() > MAX_NAMES || names.stream().anyMatch(name -> !MentionNames.valid(name))) {
            throw new IllegalArgumentException("Invalid mention context");
        }
        names = List.copyOf(names);
    }

    /** Common and client initializers share this idempotent registration in an integrated server. */
    public static synchronized void register() {
        if (!registered) {
            PayloadTypeRegistry.clientboundPlay().register(TYPE, CODEC);
            registered = true;
        }
    }

    private void write(RegistryFriendlyByteBuf output) {
        output.writeVarInt(names.size());
        names.forEach(name -> output.writeUtf(name, MentionNames.MAX_NAME));
    }

    private static MentionContextPayload read(RegistryFriendlyByteBuf input) {
        int count = input.readVarInt();
        if (count < 0 || count > MAX_NAMES) throw new IllegalArgumentException("Invalid mention count");
        java.util.ArrayList<String> names = new java.util.ArrayList<>(count);
        for (int i = 0; i < count; i++) names.add(input.readUtf(MentionNames.MAX_NAME));
        MentionContextPayload result = new MentionContextPayload(names);
        if (input.isReadable()) throw new IllegalArgumentException("Trailing mention context bytes");
        return result;
    }

    @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
