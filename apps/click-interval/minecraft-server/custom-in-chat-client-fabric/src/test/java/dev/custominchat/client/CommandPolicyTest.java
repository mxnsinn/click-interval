package dev.custominchat.client;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CommandPolicyTest {
    @Test void onlyFocusedWorldWithoutScreenCanSend() {
        for (int mask = 0; mask < 32; mask++) {
            boolean player = (mask & 1) != 0, world = (mask & 2) != 0, connection = (mask & 4) != 0;
            boolean screen = (mask & 8) != 0, focused = (mask & 16) != 0;
            assertEquals(mask == 23, CommandPolicy.eligible(player, world, connection, screen, focused), "mask=" + mask);
        }
    }

    @Test void onlyFourFixedSelfCommandsExist() {
        List<String> sent = new ArrayList<>();
        for (EnchantmentAction action : EnchantmentAction.values()) {
            CommandPolicy.request(action, true, true, sent::add, () -> fail("Should be supported"));
        }
        assertEquals(List.of("enchants", "enchants toggle miner", "enchants toggle tree", "enchants toggle harvester"), sent);
    }

    @Test void unsupportedServersReceiveNoCommandsAndOneLocalNotice() {
        for (EnchantmentAction action : EnchantmentAction.values()) {
            AtomicInteger notices = new AtomicInteger();
            CommandPolicy.request(action, true, false, command -> fail("Unexpected network command"), notices::incrementAndGet);
            assertEquals(1, notices.get());
        }
    }

    @Test void inactiveInputIsEntirelySilentRegardlessOfServerSupport() {
        for (boolean available : List.of(false, true)) {
            for (EnchantmentAction action : EnchantmentAction.values()) {
                CommandPolicy.request(action, false, available, command -> fail("Unexpected network command"),
                        () -> fail("Unexpected message"));
            }
        }
    }

    @Test void repeatedHeldUnsupportedPressProducesOnlyOneNotice() {
        PressGate gate = new PressGate();
        AtomicInteger notices = new AtomicInteger();
        gate.accept(false, false, true);
        for (int i = 0; i < 200; i++) {
            if (gate.accept(true, true, true)) {
                CommandPolicy.request(EnchantmentAction.MENU, true, false, command -> fail(), notices::incrementAndGet);
            }
        }
        assertEquals(1, notices.get());
    }
}
