package dev.serverprotection.fabric.attestation;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Server-thread-only, bounded connection state for challenge/response reports. */
public final class ClientAttestationSessions {
    public static final int MAX_SESSIONS = 16_384;
    public static final int MAX_INVALID_ATTEMPTS = 3;

    private final LinkedHashMap<UUID, Session> sessions = new LinkedHashMap<>(64, 0.75f, true);
    private final NonceSource nonces;

    public ClientAttestationSessions() {
        SecureRandom random = new SecureRandom();
        nonces = target -> random.nextBytes(target);
    }

    public ClientAttestationSessions(NonceSource nonces) {
        this.nonces = nonces == null ? target -> new SecureRandom().nextBytes(target) : nonces;
    }

    public ChallengeRequest begin(UUID playerId, boolean channelAvailable,
                                  ClientModPolicy policy, long nowMillis) {
        if (playerId == null || policy == null || !policy.enabled()) {
            if (playerId != null) sessions.remove(playerId);
            return null;
        }
        trimForInsert(playerId);
        long deadline = saturatingAdd(nowMillis, policy.graceSeconds() * 1_000L);
        if (!channelAvailable) {
            sessions.put(playerId, new Session(null, deadline, State.UNAVAILABLE));
            return null;
        }
        byte[] nonce = new byte[AttestationProtocol.NONCE_BYTES];
        nonces.fill(nonce);
        if (allZero(nonce)) nonce[nonce.length - 1] = 1;
        Session session = new Session(nonce, deadline, State.WAITING);
        sessions.put(playerId, session);
        return new ChallengeRequest(AttestationProtocol.encodeChallenge(nonce), deadline);
    }

    /** Returns null for a duplicate/unsolicited report that should be ignored. */
    public Outcome receive(UUID playerId, byte[] payload, ClientModPolicy policy, long nowMillis) {
        Session session = playerId == null ? null : sessions.get(playerId);
        if (session == null || session.state != State.WAITING || policy == null || !policy.enabled()) return null;
        if (nowMillis >= session.deadlineMillis) return finishMissing(playerId, session, policy, State.TIMED_OUT);
        try {
            AttestationProtocol.Report report = AttestationProtocol.decodeReport(payload, session.nonce);
            session.report = report;
            session.nonce = null;
            session.state = report.truncated() ? State.REPORTED_TRUNCATED : State.REPORTED_ADVISORY;
            session.terminal = true;
            ClientModPolicy.Decision decision = policy.evaluate(report);
            return new Outcome(playerId, session.state, decision, report, true, "");
        } catch (IllegalArgumentException invalid) {
            session.invalidAttempts++;
            String error = bounded(invalid.getMessage(), 160);
            if (session.invalidAttempts < MAX_INVALID_ATTEMPTS) {
                return new Outcome(playerId, State.WAITING,
                        ClientModPolicy.Decision.allow(ClientModPolicy.Status.WAITING),
                        null, false, error);
            }
            session.nonce = null;
            session.state = State.INVALID;
            session.terminal = true;
            ClientModPolicy.Decision base = policy.evaluate(null);
            ClientModPolicy.Decision decision = new ClientModPolicy.Decision(
                    base.violation(), base.modId(), ClientModPolicy.Status.INVALID);
            return new Outcome(playerId, State.INVALID, decision, null, true, error);
        }
    }

    public List<Outcome> expire(ClientModPolicy policy, long nowMillis) {
        if (sessions.isEmpty() || policy == null || !policy.enabled()) return List.of();
        ArrayList<Outcome> outcomes = new ArrayList<>();
        for (Map.Entry<UUID, Session> entry : sessions.entrySet()) {
            Session session = entry.getValue();
            if (!session.terminal && (session.state == State.WAITING || session.state == State.UNAVAILABLE)
                    && nowMillis >= session.deadlineMillis) {
                State state = session.state == State.UNAVAILABLE ? State.UNAVAILABLE : State.TIMED_OUT;
                outcomes.add(finishMissing(entry.getKey(), session, policy, state));
            }
        }
        return outcomes.isEmpty() ? List.of() : List.copyOf(outcomes);
    }

    public Snapshot status(UUID playerId) {
        Session session = playerId == null ? null : sessions.get(playerId);
        if (session == null) return new Snapshot(State.UNVERIFIED, 0, "", false, 0L);
        AttestationProtocol.Report report = session.report;
        return new Snapshot(session.state, report == null ? 0 : report.mods().size(),
                report == null ? "" : report.reporterVersion(), report != null && report.truncated(),
                session.deadlineMillis);
    }

    public void remove(UUID playerId) {
        if (playerId != null) sessions.remove(playerId);
    }

    public void clear() {
        sessions.clear();
    }

    public int size() {
        return sessions.size();
    }

    private Outcome finishMissing(UUID playerId, Session session, ClientModPolicy policy, State state) {
        session.nonce = null;
        session.state = state;
        session.terminal = true;
        ClientModPolicy.Decision base = policy.evaluate(null);
        ClientModPolicy.Status policyStatus = switch (state) {
            case INVALID -> ClientModPolicy.Status.INVALID;
            case WAITING -> ClientModPolicy.Status.WAITING;
            default -> ClientModPolicy.Status.UNVERIFIED;
        };
        ClientModPolicy.Decision decision = new ClientModPolicy.Decision(
                base.violation(), base.modId(), policyStatus);
        return new Outcome(playerId, state, decision, null, true, "");
    }

    private void trimForInsert(UUID playerId) {
        if (sessions.containsKey(playerId) || sessions.size() < MAX_SESSIONS) return;
        Iterator<UUID> iterator = sessions.keySet().iterator();
        if (iterator.hasNext()) {
            iterator.next();
            iterator.remove();
        }
    }

    private static boolean allZero(byte[] bytes) {
        int result = 0;
        for (byte value : bytes) result |= value;
        return result == 0;
    }

    private static long saturatingAdd(long left, long right) {
        if (right > 0 && left > Long.MAX_VALUE - right) return Long.MAX_VALUE;
        return left + right;
    }

    private static String bounded(String value, int maximum) {
        if (value == null) return "";
        return value.length() <= maximum ? value : value.substring(0, maximum);
    }

    @FunctionalInterface
    public interface NonceSource {
        void fill(byte[] target);
    }

    public enum State {
        UNVERIFIED,
        UNAVAILABLE,
        WAITING,
        REPORTED_ADVISORY,
        REPORTED_TRUNCATED,
        INVALID,
        TIMED_OUT
    }

    public record ChallengeRequest(byte[] payload, long deadlineMillis) {
        public ChallengeRequest {
            payload = payload == null ? new byte[0] : Arrays.copyOf(payload, payload.length);
        }

        @Override
        public byte[] payload() {
            return Arrays.copyOf(payload, payload.length);
        }
    }

    public record Outcome(
            UUID playerId,
            State state,
            ClientModPolicy.Decision decision,
            AttestationProtocol.Report report,
            boolean terminal,
            String error
    ) {
    }

    public record Snapshot(
            State state,
            int reportedModCount,
            String reporterVersion,
            boolean truncated,
            long deadlineMillis
    ) {
        public String description() {
            return switch (state) {
                case REPORTED_ADVISORY -> "reported " + reportedModCount + " mod(s); advisory, not verified";
                case REPORTED_TRUNCATED -> "reported a truncated mod list; advisory and incomplete";
                case WAITING -> "waiting for the optional companion report";
                case INVALID -> "invalid companion report; client remains unverified";
                case TIMED_OUT -> "companion report timed out; client remains unverified";
                case UNAVAILABLE -> "companion not installed or channel unavailable; client remains unverified";
                case UNVERIFIED -> "no companion report; client remains unverified";
            };
        }
    }

    private static final class Session {
        private byte[] nonce;
        private final long deadlineMillis;
        private State state;
        private int invalidAttempts;
        private AttestationProtocol.Report report;
        private boolean terminal;

        private Session(byte[] nonce, long deadlineMillis, State state) {
            this.nonce = nonce == null ? null : Arrays.copyOf(nonce, nonce.length);
            this.deadlineMillis = deadlineMillis;
            this.state = state;
        }
    }
}
