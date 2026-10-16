package com.clickinterval.chat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class RelayIsolationTest {
    @Test void resourceMetadataAllowsIntegratedServerAndDoesNotLoadProtection() throws Exception {
        String json = Files.readString(Path.of("src/main/resources/fabric.mod.json"));
        assertTrue(json.contains("\"environment\": \"*\""));
        assertTrue(json.contains("\"main\": [\"com.clickinterval.chat.ServerChat\"]"));
        assertFalse(json.contains("\"breaks\""));
        assertTrue(json.contains("\"mixins\": [\"serverchat.mixins.json\"]"));
        assertFalse(json.contains("\"jars\""));
        assertFalse(json.contains("meowantixray"));
        assertFalse(json.contains("serverprotection_fabric"));
    }

    @Test void noProtectionOrTypingSourcesAreIncluded() throws Exception {
        String build = Files.readString(Path.of("build.gradle"));
        assertFalse(build.contains("sharedTyping"));
        assertFalse(build.contains("dev/serverprotection/fabric/typing"));
        assertFalse(build.contains("include 'dev/serverprotection/fabric/**'"));
        assertFalse(build.contains("click-interval-anticheat"));
        assertFalse(build.contains("compileOnly files("));
        assertFalse(build.contains("META-INF/jars"));
    }

    @Test void commonEntrypointRegistersOnlyMentionsWithoutTypingHooks() throws Exception {
        String entry = Files.readString(Path.of("src/main/java/com/clickinterval/chat/ServerChat.java"));
        for (String event : new String[]{"SERVER_STARTING", "SERVER_STOPPED", "END_SERVER_TICK",
                "ServerPlayConnectionEvents.JOIN", "ServerPlayConnectionEvents.DISCONNECT", "ALLOW_CHAT_MESSAGE"}) {
            assertFalse(entry.contains(event + ".register("), event);
        }
        assertTrue(entry.contains("mentions.register()"));
        assertFalse(entry.contains("RelayOwnership"));
        assertFalse(entry.contains("registerReceiver"));
        assertFalse(entry.contains("import net.minecraft.client."));
        assertFalse(entry.contains("CommandRegistrationCallback"));
        assertFalse(entry.contains("Commands.literal"));
    }
}
