package dev.custominchat.client;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CommandTreeSupportTest {
    @Test void absentCommandIsUnsupported() {
        assertFalse(CommandTreeSupport.supports(null));
        assertFalse(CommandTreeSupport.supports(new CommandDispatcher<>().getRoot()));
    }

    @Test void unrelatedModUsingSameRootIsUnsupported() {
        CommandDispatcher<Object> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.literal("enchants"));
        assertFalse(CommandTreeSupport.supports(dispatcher.getRoot()));
    }

    @Test void completeExpectedSelfServiceTreeIsSupported() {
        CommandDispatcher<Object> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.literal("enchants").then(
                LiteralArgumentBuilder.literal("toggle")
                        .then(LiteralArgumentBuilder.literal("miner"))
                        .then(LiteralArgumentBuilder.literal("tree"))
                        .then(LiteralArgumentBuilder.literal("harvester"))));
        assertTrue(CommandTreeSupport.supports(dispatcher.getRoot()));
    }

    @Test void incompleteOrRestrictedTreeIsUnsupported() {
        for (String missing : new String[]{"miner", "tree", "harvester"}) {
            CommandDispatcher<Object> dispatcher = new CommandDispatcher<>();
            var toggle = LiteralArgumentBuilder.literal("toggle");
            for (String child : new String[]{"miner", "tree", "harvester"}) {
                if (!missing.equals(child)) toggle.then(LiteralArgumentBuilder.literal(child));
            }
            dispatcher.register(LiteralArgumentBuilder.literal("enchants").then(toggle));
            assertFalse(CommandTreeSupport.supports(dispatcher.getRoot()));
        }
    }
}
