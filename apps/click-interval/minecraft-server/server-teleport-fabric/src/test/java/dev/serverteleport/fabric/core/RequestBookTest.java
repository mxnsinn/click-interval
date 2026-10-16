package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class RequestBookTest {
    @Test
    void createsAndIndexesARequest() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(1);
        UUID sam = id(2);

        RequestOutcome result = book.create(alex, "Alex", sam, "Sam", false);

        assertEquals(RequestOutcome.Status.CREATED, result.status());
        assertEquals(alex, result.request().requesterId());
        assertEquals(sam, result.request().targetId());
        assertEquals(clock.nowMillis() + 60_000L, result.request().expiresAtMillis());
        assertEquals(result.request(), book.outgoingFor(alex));
        assertEquals(List.of(result.request()), book.incomingFor(sam));
        assertEquals(1, book.size());
    }

    @Test
    void rejectsSelfAndDuplicateOutgoingRequests() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(3);
        UUID sam = id(4);
        UUID robin = id(5);

        assertEquals(RequestOutcome.Status.SELF_TARGET,
                book.create(alex, "Alex", alex, "Alex", false).status());
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", false).status());
        RequestOutcome duplicate = book.create(alex, "Alex", robin, "Robin", false);
        assertEquals(RequestOutcome.Status.OUTGOING_EXISTS, duplicate.status());
        assertEquals("Sam", duplicate.request().targetName());
        assertEquals(List.of(), book.incomingFor(robin));
    }

    @Test
    void revokingForLocalTravelMakesLateAcceptanceImpossible() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID requester = id(9);
        UUID target = id(10);
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(requester, "Alex", target, "Sam", false).status());

        assertEquals(RequestOutcome.Status.CANCELLED, book.cancel(requester).status());
        assertNull(book.outgoingFor(requester));
        assertEquals(List.of(), book.incomingFor(target));
        assertEquals(RequestOutcome.Status.NONE, book.respond(target, "Alex", true).status());
    }

    @Test
    void enforcesCooldownAtTheExactBoundaryAndAllowsAdminBypass() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(6);
        UUID sam = id(7);
        UUID robin = id(8);

        book.create(alex, "Alex", sam, "Sam", false);
        book.cancel(alex);
        RequestOutcome cooling = book.create(alex, "Alex", robin, "Robin", false);
        assertEquals(RequestOutcome.Status.COOLDOWN, cooling.status());
        assertEquals(10_000L, cooling.retryAfterMillis());
        clock.advance(9_999L);
        assertEquals(1L, book.create(alex, "Alex", robin, "Robin", false).retryAfterMillis());
        clock.advance(1L);
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", robin, "Robin", false).status());
        book.cancel(alex);
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", true).status());
    }

    @Test
    void enforcesPerTargetAndGlobalCaps() {
        MutableClock clock = new MutableClock();
        RequestBook perTarget = book(clock, 2, 100);
        UUID target = id(20);
        perTarget.create(id(21), "Alex", target, "Target", false);
        perTarget.create(id(22), "Bob", target, "Target", false);
        assertEquals(RequestOutcome.Status.TARGET_LIMIT,
                perTarget.create(id(23), "Chris", target, "Target", false).status());

        RequestBook global = book(clock, 8, 2);
        global.create(id(30), "Alex", id(31), "Sam", false);
        global.create(id(32), "Bob", id(33), "Robin", false);
        assertEquals(RequestOutcome.Status.SERVER_LIMIT,
                global.create(id(34), "Chris", id(35), "Taylor", false).status());
        assertEquals(2, global.size());
    }

    @Test
    void requiresANameWhenIncomingRequestsAreAmbiguous() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID target = id(40);
        UUID bob = id(41);
        UUID alex = id(42);
        book.create(bob, "Bob", target, "Target", false);
        book.create(alex, "Alex", target, "Target", false);

        RequestOutcome ambiguous = book.respond(target, "", true);
        assertEquals(RequestOutcome.Status.AMBIGUOUS, ambiguous.status());
        assertEquals(List.of("Alex", "Bob"), ambiguous.candidates().stream()
                .map(TeleportRequest::requesterName).toList());
        assertThrows(UnsupportedOperationException.class,
                () -> ambiguous.candidates().add(ambiguous.candidates().getFirst()));

        RequestOutcome reserved = book.respond(target, "bOB", true);
        assertEquals(RequestOutcome.Status.RESERVED, reserved.status());
        assertNotNull(book.outgoingFor(bob));
        assertTrue(book.commit(reserved.reservation()));
        assertNull(book.outgoingFor(bob));
        assertEquals(RequestOutcome.Status.DENIED, book.respond(target, "", false).status());
        assertEquals(RequestOutcome.Status.NONE, book.respond(target, "", true).status());
    }

    @Test
    void failedAcceptanceCanBeReleasedWithoutConsumingConsent() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(90);
        UUID sam = id(91);
        TeleportRequest request = book.create(alex, "Alex", sam, "Sam", false).request();

        RequestOutcome first = book.respond(sam, "Alex", true);
        assertEquals(RequestOutcome.Status.RESERVED, first.status());
        assertEquals(request, book.outgoingFor(alex));
        assertEquals(List.of(request), book.incomingFor(sam));
        assertEquals(RequestOutcome.Status.BUSY, book.respond(sam, "Alex", true).status());
        assertEquals(RequestOutcome.Status.BUSY, book.respond(sam, "Alex", false).status());
        assertEquals(RequestOutcome.Status.BUSY, book.cancel(alex).status());

        assertTrue(book.release(first.reservation()));
        assertEquals(request, book.outgoingFor(alex));
        RequestOutcome second = book.respond(sam, "Alex", true);
        assertEquals(RequestOutcome.Status.RESERVED, second.status());
        assertNotEquals(first.reservation().id(), second.reservation().id());
        assertFalse(book.commit(first.reservation()));
        assertEquals(request, book.outgoingFor(alex));
        assertTrue(book.commit(second.reservation()));
        assertNull(book.outgoingFor(alex));
        assertFalse(book.commit(second.reservation()));
    }

    @Test
    void movementCancellationConsumesAcceptedCombatWarmup() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID requester = id(110);
        UUID target = id(111);
        book.create(requester, "Alex", target, "Sam", false);
        AcceptanceReservation reservation = book.respond(target, "Alex", true).reservation();
        TeleportWarmupState warmup = new TeleportWarmupState(
                clock.nowMillis(), "minecraft:overworld", 10.0, 64.0, 10.0);

        assertEquals(TeleportWarmupState.Status.MOVED,
                warmup.update(clock.nowMillis() + 50L, "minecraft:overworld",
                        10.0001, 64.0, 10.0, true).status());
        assertTrue(book.invalidate(reservation));
        assertAcceptedWarmupWasConsumed(book, requester, target, reservation);
    }

    @Test
    void damageCancellationConsumesAcceptedCombatWarmup() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID requester = id(112);
        UUID target = id(113);
        book.create(requester, "Alex", target, "Sam", false);
        AcceptanceReservation reservation = book.respond(target, "Alex", true).reservation();

        // ServerTeleportFabric's damage callback invokes this terminal reservation operation.
        assertTrue(book.invalidate(reservation));
        assertAcceptedWarmupWasConsumed(book, requester, target, reservation);
    }

    @Test
    void aReservationCannotExpireMidTransactionButExpiredConsentIsNotRestored() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(92);
        UUID sam = id(93);
        book.create(alex, "Alex", sam, "Sam", false);
        RequestOutcome reserved = book.respond(sam, "Alex", true);

        clock.advance(60_000L);
        assertEquals(List.of(), book.expire());
        assertEquals(1, book.size());
        assertTrue(book.release(reserved.reservation()));
        assertEquals(0, book.size());
        assertNull(book.outgoingFor(alex));
        assertFalse(book.commit(reserved.reservation()));
    }

    @Test
    void acceptanceAtDeadlineRetainsConsentWhenNewRequestsArriveDuringTerrainPreparation() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID requester = id(120);
        UUID target = id(121);
        UUID otherTarget = id(122);
        TeleportRequest request = book.create(requester, "Alex", target, "Sam", false).request();
        clock.advance(59_999L);
        AcceptanceReservation reservation = book.respond(target, "Alex", true).reservation();
        assertNotNull(reservation);

        // Loading starts just before the request deadline and finishes on later server ticks.
        clock.advance(1L);
        assertEquals(RequestOutcome.Status.OUTGOING_EXISTS,
                book.create(requester, "Alex", otherTarget, "Robin", false).status());
        clock.advance(10_000L);
        assertEquals(RequestOutcome.Status.OUTGOING_EXISTS,
                book.create(requester, "Alex", otherTarget, "Robin", true).status());
        assertEquals(List.of(), book.expire());
        assertEquals(request, book.outgoingFor(requester));
        assertEquals(List.of(request), book.incomingFor(target));
        assertEquals(List.of(), book.incomingFor(otherTarget));
        assertTrue(book.isActiveReservation(reservation));
        assertTrue(book.commit(reservation));
        assertFalse(book.isActiveReservation(reservation));
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(requester, "Alex", otherTarget, "Robin", false).status());
    }

    @Test
    void invalidatedAsyncConsentCannotAuthorizeAReplacementRequest() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID requester = id(123);
        UUID target = id(124);
        UUID otherTarget = id(125);
        book.create(requester, "Alex", target, "Sam", true);
        AcceptanceReservation first = book.respond(target, "Alex", true).reservation();
        assertTrue(book.isActiveReservation(first));
        assertTrue(book.invalidate(first));
        book.create(requester, "Alex", otherTarget, "Robin", true);
        AcceptanceReservation replacement = book.respond(otherTarget, "Alex", true).reservation();
        assertFalse(book.isActiveReservation(first));
        assertFalse(book.commit(first));
        assertTrue(book.isActiveReservation(replacement));
        assertFalse(book.isActiveReservation(null));
        book.removePlayer(otherTarget);
        assertFalse(book.isActiveReservation(replacement));
    }

    @Test
    void disconnectInvalidatesAReservationAndPreventsReplay() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(94);
        UUID sam = id(95);
        book.create(alex, "Alex", sam, "Sam", false);
        AcceptanceReservation reservation = book.respond(sam, "Alex", true).reservation();

        assertEquals(1, book.removePlayer(alex).size());
        assertFalse(book.commit(reservation));
        assertFalse(book.release(reservation));
        assertEquals(0, book.size());
        assertEquals(RequestOutcome.Status.NONE, book.respond(sam, "Alex", true).status());
    }

    private static void assertAcceptedWarmupWasConsumed(
            RequestBook book,
            UUID requester,
            UUID target,
            AcceptanceReservation reservation) {
        assertNull(book.outgoingFor(requester));
        assertEquals(List.of(), book.incomingFor(target));
        assertEquals(0, book.size());
        assertEquals(RequestOutcome.Status.NONE, book.respond(target, "Alex", true).status());
        assertFalse(book.release(reservation));
        assertFalse(book.commit(reservation));
        assertFalse(book.invalidate(reservation));
    }

    @Test
    void releasingAnAcceptanceDoesNotRewriteTheOriginalCooldown() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(96);
        UUID sam = id(97);
        UUID robin = id(98);
        book.create(alex, "Alex", sam, "Sam", false);
        clock.advance(2_000L);
        AcceptanceReservation reservation = book.respond(sam, "Alex", true).reservation();

        assertTrue(book.release(reservation));
        assertEquals(RequestOutcome.Status.CANCELLED, book.cancel(alex).status());
        RequestOutcome cooling = book.create(alex, "Alex", robin, "Robin", false);
        assertEquals(RequestOutcome.Status.COOLDOWN, cooling.status());
        assertEquals(8_000L, cooling.retryAfterMillis());
    }

    @Test
    void expiresAtTheExactBoundaryAndPrunesCooldowns() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(50);
        UUID sam = id(51);
        book.create(alex, "Alex", sam, "Sam", false);

        clock.advance(59_999L);
        assertEquals(List.of(), book.expire());
        clock.advance(1L);
        assertEquals(List.of("Alex"), book.expire().stream()
                .map(TeleportRequest::requesterName).toList());
        assertEquals(0, book.size());
        assertEquals(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", false).status());
    }

    @Test
    void disconnectCleanupRemovesBothDirectionsAndNothingElse() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(60);
        UUID middle = id(61);
        UUID bob = id(62);
        UUID chris = id(63);
        book.create(alex, "Alex", middle, "Middle", false);
        book.create(middle, "Middle", bob, "Bob", false);
        book.create(chris, "Chris", bob, "Bob", false);

        assertEquals(2, book.removePlayer(middle).size());
        assertEquals(1, book.size());
        assertEquals("Chris", book.incomingFor(bob).getFirst().requesterName());
        assertEquals(RequestOutcome.Status.CANCELLED, book.cancel(chris).status());
        assertEquals(RequestOutcome.Status.NONE, book.cancel(chris).status());
    }

    @Test
    void reconfigurationChangesOnlyNewRequestTiming() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        TeleportRequest old = book.create(id(70), "Alex", id(71), "Sam", false).request();
        book.configure(5_000L, 2_000L, 1, 10);
        TeleportRequest fresh = book.create(id(72), "Bob", id(73), "Robin", false).request();

        assertEquals(60_000L, old.expiresAtMillis() - old.createdAtMillis());
        assertEquals(5_000L, fresh.expiresAtMillis() - fresh.createdAtMillis());
    }

    @Test
    void rejectsInvalidBoundsAndNames() {
        MutableClock clock = new MutableClock();
        assertThrows(IllegalArgumentException.class, () -> new RequestBook(clock, 4_999L, 0L, 1, 1));
        assertThrows(IllegalArgumentException.class, () -> new RequestBook(clock, 5_000L, -1L, 1, 1));
        assertThrows(IllegalArgumentException.class, () -> new RequestBook(clock, 5_000L, 0L, 0, 1));
        assertThrows(IllegalArgumentException.class, () -> new RequestBook(clock, 5_000L, 0L, 1, 0));
        assertThrows(IllegalArgumentException.class,
                () -> new TeleportRequest(id(80), "Bad Name", id(81), "Sam", 1L, 2L));
    }

    private static RequestBook book(MutableClock clock, int incoming, int total) {
        return new RequestBook(clock, 60_000L, 10_000L, incoming, total);
    }

    @Test void randomTravelSharesCooldownInBothDirectionsAndSurvivesLogout() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID alex = id(500), sam = id(501);
        book.startLocalTravelCooldown(alex, false);
        assertEquals(10_000, book.remainingCooldownMillis(alex, false));
        assertEquals(RequestOutcome.Status.COOLDOWN, book.create(alex, "Alex", sam, "Sam", false).status());
        book.removePlayer(alex);
        assertEquals(10_000, book.remainingCooldownMillis(alex, false));
        assertEquals(0, book.remainingCooldownMillis(alex, true));
        clock.advance(10_000);
        assertEquals(0, book.remainingCooldownMillis(alex, false));
        assertEquals(RequestOutcome.Status.CREATED, book.create(alex, "Alex", sam, "Sam", false).status());
        book.cancel(alex);
        assertEquals(10_000, book.remainingCooldownMillis(alex, false));
    }

    @Test void randomCooldownHonorsZeroAndExistingAdminBypass() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        book.startLocalTravelCooldown(id(600), true);
        assertEquals(0, book.remainingCooldownMillis(id(600), false));
        book.configure(60_000, 0, 8, 100);
        book.startLocalTravelCooldown(id(601), false);
        assertEquals(0, book.remainingCooldownMillis(id(601), false));
    }

    private static UUID id(long value) {
        return new UUID(0L, value);
    }

    @Test void deathClearsLocalTravelCooldownButTheNextLifeGetsNormalCooldownAgain() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID player = id(700), target = id(701);
        book.startLocalTravelCooldown(player, false);
        assertEquals(10_000, book.remainingCooldownMillis(player, false));
        assertTrue(book.removePlayerAfterDeath(player).isEmpty());
        assertEquals(0, book.remainingCooldownMillis(player, false));
        assertEquals(RequestOutcome.Status.CREATED, book.create(player, "Alex", target, "Sam", false).status());
        assertEquals(10_000, book.remainingCooldownMillis(player, false));
        book.removePlayer(player);
        assertEquals(10_000, book.remainingCooldownMillis(player, false), "logout is not a death reset");
    }

    @Test void requesterDeathDuringReservedWarmupInvalidatesOldCallbacksWithoutTouchingFreshConsent() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID player = id(710), target = id(711);
        book.create(player, "Alex", target, "Sam", false);
        AcceptanceReservation oldLife = book.respond(target, "Alex", true).reservation();
        assertEquals(1, book.removePlayerAfterDeath(player).size());
        assertEquals(0, book.remainingCooldownMillis(player, false));
        assertFalse(book.isActiveReservation(oldLife));
        assertEquals(RequestOutcome.Status.CREATED, book.create(player, "Alex", target, "Sam", false).status());
        AcceptanceReservation newLife = book.respond(target, "Alex", true).reservation();
        assertFalse(book.commit(oldLife));
        assertFalse(book.release(oldLife));
        assertFalse(book.invalidate(oldLife));
        assertTrue(book.isActiveReservation(newLife));
        assertTrue(book.commit(newLife));
    }

    @Test void targetDeathInvalidatesIncomingReservationsWithoutRefundingOtherPlayersCooldown() {
        MutableClock clock = new MutableClock();
        RequestBook book = book(clock, 8, 100);
        UUID player = id(720), target = id(721);
        book.create(player, "Alex", target, "Sam", false);
        AcceptanceReservation reservation = book.respond(target, "Alex", true).reservation();
        assertEquals(1, book.removePlayerAfterDeath(target).size());
        assertFalse(book.isActiveReservation(reservation));
        assertEquals(10_000, book.remainingCooldownMillis(player, false));
        assertEquals(RequestOutcome.Status.NONE, book.respond(target, "Alex", true).status());
    }

    private static final class MutableClock implements Clock {
        private long now = 1_000_000L;

        @Override
        public long nowMillis() {
            return now;
        }

        void advance(long millis) {
            now += millis;
        }
    }
}
