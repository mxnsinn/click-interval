package dev.serverprotection.client.mixin;

import com.mojang.brigadier.suggestion.Suggestions;
import dev.serverprotection.client.MentionSuggestions;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.CommandSuggestions;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(CommandSuggestions.class)
public abstract class ChatMentionSuggestionsMixin {
    @Shadow @Final private Minecraft minecraft;
    @Shadow @Final private Screen screen;
    @Shadow @Final private EditBox input;
    @Shadow @Final private boolean commandsOnly;
    @Shadow private boolean allowSuggestions;
    @Shadow private boolean keepSuggestions;
    @Shadow private boolean messagesAllowed;
    @Shadow private CompletableFuture<Suggestions> pendingSuggestions;
    @Shadow public abstract void showSuggestions(boolean narrateFirstSuggestion);

    // Vanilla owns rendering, arrows, Tab insertion/cycling and Escape. Never requests server suggestions.
    @Inject(method = "updateCommandInfo", at = @At("TAIL"))
    private void serverProtection$automaticMentions(CallbackInfo callback) {
        if (!(screen instanceof ChatScreen) || commandsOnly || !messagesAllowed || !allowSuggestions
                || keepSuggestions || minecraft.getConnection() == null) return;
        Suggestions matches = MentionSuggestions.build(input.getValue(), input.getCursorPosition(),
                minecraft.getConnection().getSuggestionsProvider().getCustomTabSuggestions());
        if (matches == null) return;
        pendingSuggestions = CompletableFuture.completedFuture(matches);
        if (!matches.isEmpty()) showSuggestions(false);
    }
}
