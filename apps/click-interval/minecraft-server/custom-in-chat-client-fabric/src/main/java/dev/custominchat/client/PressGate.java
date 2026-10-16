package dev.custominchat.client;

/** One action per physical press, including key repeat and GUI/focus transitions. */
final class PressGate {
    private boolean previouslyDown = true;

    boolean accept(boolean queuedPress, boolean physicallyDown, boolean eligible) {
        boolean freshPress = queuedPress && !previouslyDown;
        previouslyDown = physicallyDown;
        return eligible && freshPress;
    }
}
