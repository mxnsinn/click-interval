package dev.serverprotection.fabric.mixin;

import net.minecraft.network.protocol.game.ServerboundCommandSuggestionPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Stable field access across the 26.2 class and 26.3 record packet layouts. */
@Mixin(ServerboundCommandSuggestionPacket.class)
interface CommandSuggestionPacketAccessor {
    @Accessor("id")
    int serverProtection$suggestionId();

    @Accessor("command")
    String serverProtection$command();
}
