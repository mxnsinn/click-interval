package dev.custominchat.client;

import java.util.function.Consumer;

/** Does not predict server state: successful requests are answered by the native server UI/chat. */
final class CommandPolicy {
    private CommandPolicy() {}

    static boolean eligible(boolean playerPresent, boolean worldPresent, boolean connectionPresent,
                            boolean screenOpen, boolean windowFocused) {
        return playerPresent && worldPresent && connectionPresent && !screenOpen && windowFocused;
    }

    static void request(EnchantmentAction action, boolean eligible, boolean commandAvailable,
                        Consumer<String> send, Runnable unsupported) {
        if (!eligible) return;
        if (!commandAvailable) { unsupported.run(); return; }
        send.accept(action.command());
    }
}
