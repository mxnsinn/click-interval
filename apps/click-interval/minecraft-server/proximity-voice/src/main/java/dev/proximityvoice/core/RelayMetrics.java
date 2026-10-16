package dev.proximityvoice.core;

import java.util.concurrent.atomic.AtomicLong;

public final class RelayMetrics {
    private final AtomicLong received = new AtomicLong();
    private final AtomicLong authenticated = new AtomicLong();
    private final AtomicLong rejected = new AtomicLong();
    private final AtomicLong replayed = new AtomicLong();
    private final AtomicLong rateLimited = new AtomicLong();
    private final AtomicLong associations = new AtomicLong();
    private final AtomicLong voiceFrames = new AtomicLong();
    private final AtomicLong routedRecipients = new AtomicLong();

    void received() { received.incrementAndGet(); }
    void authenticated() { authenticated.incrementAndGet(); }
    void rejected() { rejected.incrementAndGet(); }
    void replayed() { replayed.incrementAndGet(); }
    void rateLimited() { rateLimited.incrementAndGet(); }
    void associated() { associations.incrementAndGet(); }
    void voiceFrame() { voiceFrames.incrementAndGet(); }
    void routedRecipients(int count) { routedRecipients.addAndGet(Math.max(0, count)); }

    public Snapshot snapshot() {
        return new Snapshot(
                received.get(), authenticated.get(), rejected.get(), replayed.get(), rateLimited.get(),
                associations.get(), voiceFrames.get(), routedRecipients.get());
    }

    public record Snapshot(
            long received,
            long authenticated,
            long rejected,
            long replayed,
            long rateLimited,
            long associations,
            long voiceFrames,
            long routedRecipients
    ) {}
}
