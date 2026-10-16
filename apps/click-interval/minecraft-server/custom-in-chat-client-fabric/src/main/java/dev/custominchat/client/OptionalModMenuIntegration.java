package dev.custominchat.client;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.options.controls.KeyBindsScreen;

/** Loaded by Mod Menu only when present; the core client never links this optional API. */
public final class OptionalModMenuIntegration implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return parent -> new KeyBindsScreen(parent, Minecraft.getInstance().options);
    }
}
