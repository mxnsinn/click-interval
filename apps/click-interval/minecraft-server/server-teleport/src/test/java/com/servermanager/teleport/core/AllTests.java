package com.servermanager.teleport.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AllTests {
    private int assertions;

    public static void main(String[] args) throws Exception {
        AllTests tests = new AllTests();
        tests.requestsAreCreatedAndIndexed();
        tests.selfAndDuplicateRequestsAreRejected();
        tests.cooldownIsDeterministicAndBypassable();
        tests.incomingLimitAndAmbiguityAreSafe();
        tests.expiryUsesAnExactBoundary();
        tests.playerRemovalCleansBothDirections();
        tests.reconfigurationAffectsNewRequests();
        tests.messageRenderingIsNeutralConfigurableAndSafe();
        tests.placeNamesAndCoordinatesAreSafe();
        tests.placeBookIsBoundedAndCaseInsensitive();
        tests.placeFileRoundTripsAtomically();
        tests.invalidCoreInputsAreRejected();
        System.out.println("PASS ServerTeleport pure logic tests (" + tests.assertions + " assertions)");
    }

    private void requestsAreCreatedAndIndexed() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 10_000L, 8);
        UUID alex = id(1);
        UUID sam = id(2);
        RequestOutcome result = book.create(alex, "Alex", sam, "Sam", false);

        equal(RequestOutcome.Status.CREATED, result.status(), "request created");
        equal(alex, result.request().requesterId(), "requester UUID");
        equal(sam, result.request().targetId(), "target UUID");
        equal(clock.nowMillis() + 60_000L, result.request().expiresAtMillis(), "expiry captured");
        equal(result.request(), book.outgoingFor(alex), "outgoing index");
        equal(List.of(result.request()), book.incomingFor(sam), "incoming index");
        equal(1, book.size(), "request count");
    }

    private void selfAndDuplicateRequestsAreRejected() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 0L, 8);
        UUID alex = id(3);
        UUID sam = id(4);
        UUID robin = id(5);

        equal(RequestOutcome.Status.SELF_TARGET,
                book.create(alex, "Alex", alex, "Alex", false).status(), "self request rejected");
        equal(0, book.size(), "self request not indexed");
        equal(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", false).status(), "first outgoing request");
        RequestOutcome duplicate = book.create(alex, "Alex", robin, "Robin", false);
        equal(RequestOutcome.Status.OUTGOING_EXISTS, duplicate.status(), "second outgoing rejected");
        equal("Sam", duplicate.request().targetName(), "existing target returned");
        equal(0, book.incomingFor(robin).size(), "rejected target untouched");
    }

    private void cooldownIsDeterministicAndBypassable() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 10_000L, 8);
        UUID alex = id(6);
        UUID sam = id(7);
        UUID robin = id(8);

        book.create(alex, "Alex", sam, "Sam", false);
        equal(RequestOutcome.Status.CANCELLED, book.cancel(alex).status(), "first request cancelled");
        RequestOutcome cooling = book.create(alex, "Alex", robin, "Robin", false);
        equal(RequestOutcome.Status.COOLDOWN, cooling.status(), "cooldown enforced");
        equal(10_000L, cooling.retryAfterMillis(), "full retry duration");
        clock.advance(9_999L);
        equal(1L, book.create(alex, "Alex", robin, "Robin", false).retryAfterMillis(), "last cooldown millisecond");
        clock.advance(1L);
        equal(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", robin, "Robin", false).status(), "cooldown boundary opens");
        book.cancel(alex);
        equal(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", true).status(), "permission bypass skips cooldown");
    }

    private void incomingLimitAndAmbiguityAreSafe() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 0L, 2);
        UUID alex = id(9);
        UUID bob = id(10);
        UUID chris = id(11);
        UUID target = id(12);
        book.create(bob, "Bob", target, "Target", false);
        book.create(alex, "Alex", target, "Target", false);

        equal(RequestOutcome.Status.TARGET_LIMIT,
                book.create(chris, "Chris", target, "Target", false).status(), "incoming limit enforced");
        RequestOutcome ambiguous = book.respond(target, "", true);
        equal(RequestOutcome.Status.AMBIGUOUS, ambiguous.status(), "unnamed response is ambiguous");
        equal(List.of("Alex", "Bob"), ambiguous.candidates().stream()
                .map(TeleportRequest::requesterName).toList(), "candidates sorted");
        throwsUnsupported(() -> ambiguous.candidates().add(ambiguous.candidates().get(0)),
                "candidate result is immutable");

        RequestOutcome accepted = book.respond(target, "bOB", true);
        equal(RequestOutcome.Status.ACCEPTED, accepted.status(), "named request accepted case-insensitively");
        equal("Bob", accepted.request().requesterName(), "correct requester consumed");
        equal(null, book.outgoingFor(bob), "accepted outgoing removed");
        equal(1, book.incomingFor(target).size(), "other incoming remains");
        equal(RequestOutcome.Status.DENIED, book.respond(target, "", false).status(), "sole request denied");
        equal(RequestOutcome.Status.NONE, book.respond(target, "", true).status(), "response cannot replay");
    }

    private void expiryUsesAnExactBoundary() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 10_000L, 8);
        UUID alex = id(13);
        UUID sam = id(14);
        book.create(alex, "Alex", sam, "Sam", false);
        clock.advance(59_999L);
        equal(0, book.expire().size(), "request active before boundary");
        equal(1, book.size(), "active request retained");
        clock.advance(1L);
        List<TeleportRequest> expired = book.expire();
        equal(1, expired.size(), "request expires on boundary");
        equal("Alex", expired.get(0).requesterName(), "expired request returned for notification");
        equal(0, book.size(), "expired request removed");
        equal(RequestOutcome.Status.CREATED,
                book.create(alex, "Alex", sam, "Sam", false).status(), "expired cooldown pruned");
    }

    private void playerRemovalCleansBothDirections() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 0L, 8);
        UUID alex = id(15);
        UUID middle = id(16);
        UUID bob = id(17);
        UUID chris = id(18);
        book.create(alex, "Alex", middle, "Middle", false);
        book.create(middle, "Middle", bob, "Bob", false);
        book.create(chris, "Chris", bob, "Bob", false);

        List<TeleportRequest> removed = book.removePlayer(middle);
        equal(2, removed.size(), "both request directions removed");
        equal(1, book.size(), "unrelated request retained");
        equal("Chris", book.incomingFor(bob).get(0).requesterName(), "unrelated incoming retained");
        equal(RequestOutcome.Status.CANCELLED, book.cancel(chris).status(), "remaining request cancellable");
        equal(RequestOutcome.Status.NONE, book.cancel(chris).status(), "cancel cannot replay");
    }

    private void reconfigurationAffectsNewRequests() {
        MutableClock clock = new MutableClock();
        RequestBook book = new RequestBook(clock, 60_000L, 0L, 8);
        UUID alex = id(19);
        UUID sam = id(20);
        UUID bob = id(21);
        UUID robin = id(22);
        TeleportRequest old = book.create(alex, "Alex", sam, "Sam", false).request();
        book.configure(5_000L, 2_000L, 1);
        TeleportRequest fresh = book.create(bob, "Bob", robin, "Robin", false).request();
        equal(60_000L, old.expiresAtMillis() - old.createdAtMillis(), "existing expiry unchanged");
        equal(5_000L, fresh.expiresAtMillis() - fresh.createdAtMillis(), "new expiry applied");
        book.cancel(bob);
        equal(RequestOutcome.Status.COOLDOWN,
                book.create(bob, "Bob", sam, "Sam", false).status(), "new cooldown applied");
    }

    private void messageRenderingIsNeutralConfigurableAndSafe() {
        MessageCatalog defaults = MessageCatalog.defaults();
        for (Map.Entry<String, String> entry : MessageCatalog.defaultTemplates().entrySet()) {
            check(!entry.getValue().toLowerCase().contains("click interval"), "default has no product branding");
            check(!entry.getValue().toLowerCase().contains("assembly"), "default has no legacy branding");
        }
        String incoming = defaults.render("request-received", Map.of(
                "requester", "Alex",
                "seconds", 60));
        check(incoming.startsWith("§e"), "legacy color translated");
        check(incoming.contains("TPA request from Alex"), "placeholder expanded");
        check(incoming.contains("accept or decline"), "response choices are clear");

        MessageCatalog custom = new MessageCatalog(Map.of(
                "request-sent", "&a{requester}: {target} {unknown}",
                "no-pending", "",
                "not-a-real-key", "ignored"
        ));
        String safe = custom.render("request-sent", Map.of(
                "requester", "A&clex",
                "target", "S§4am\n"));
        check(safe.startsWith("§a"), "custom template color translated");
        check(safe.contains("Alex: Sam"), "dynamic formatting and controls stripped");
        check(!safe.contains("{unknown}"), "unknown placeholder removed");
        equal("", custom.render("no-pending", Map.of()), "blank override suppresses message");
        equal("", custom.render("not-a-real-key", Map.of()), "unknown message key unavailable");

        String bounded = new MessageCatalog(Map.of("teleport-failed", "x".repeat(1_500)))
                .render("teleport-failed", Map.of());
        check(bounded.length() <= MessageCatalog.MAX_MESSAGE_LENGTH, "rendered message bounded");
    }

    private void placeNamesAndCoordinatesAreSafe() {
        check(PlaceNames.isValid("home"), "simple place name accepted");
        check(PlaceNames.isValid("Farm_2"), "underscore and case accepted");
        check(PlaceNames.isValid("nether-base"), "hyphen accepted");
        check(!PlaceNames.isValid("accept"), "accept command reserved");
        check(!PlaceNames.isValid("decline"), "decline command reserved");
        equal("farm_2", PlaceNames.normalize("Farm_2"), "place name canonicalized");
        check(!PlaceNames.isValid("my home"), "spaces rejected");
        check(!PlaceNames.isValid("../home"), "path punctuation rejected");
        check(!PlaceNames.isValid("x".repeat(25)), "long name rejected");
        check(!PlaceNames.isValid("SET"), "set reserved case-insensitively");
        check(!PlaceNames.isValid("list"), "list reserved");
        check(!PlaceNames.isValid("Delete"), "delete reserved case-insensitively");

        UUID world = id(25);
        SavedPlace place = new SavedPlace(world, "world", 12.25D, 64.0D, -8.5D, 179.5F, -45.0F);
        equal(world, place.worldId(), "world UUID retained");
        equal("world", place.worldName(), "world name retained");
        equal(12.25D, place.x(), "x retained exactly");
        equal(179.5F, place.yaw(), "yaw retained exactly");
        equal(-45.0F, place.pitch(), "pitch retained exactly");
        throwsIllegalArgument(() -> new SavedPlace(world, "world", Double.NaN, 64, 0, 0, 0),
                "non-finite coordinates rejected");
        throwsIllegalArgument(() -> new SavedPlace(world, "world", 30_000_001, 64, 0, 0, 0),
                "coordinates beyond hard limit rejected");
        throwsIllegalArgument(() -> new SavedPlace(world, "bad\nworld", 0, 64, 0, 0, 0),
                "control characters in world name rejected");
        throwsIllegalArgument(() -> new SavedPlace(world, "world", 0, 64, 0, 0, 90.1F),
                "pitch beyond player range rejected");
    }

    private void placeBookIsBoundedAndCaseInsensitive() {
        PlaceBook book = new PlaceBook();
        UUID player = id(26);
        UUID otherPlayer = id(27);
        SavedPlace first = new SavedPlace(id(100), "world", 1, 64, 2, 3, 4);
        SavedPlace updated = new SavedPlace(id(101), "world_nether", 5, 70, 6, 7, 8);

        equal(PlaceBook.PutResult.CREATED, book.put(player, "Home", first), "place created");
        equal(first, book.get(player, "HOME"), "place lookup is case-insensitive");
        equal(PlaceBook.PutResult.UPDATED, book.put(player, "hOmE", updated), "case variant updates");
        equal(1, book.count(player), "update does not consume another slot");
        equal(updated, book.get(player, "home"), "updated value returned");
        for (int index = 1; index < PlaceBook.MAX_PLACES_PER_PLAYER; index++) {
            equal(PlaceBook.PutResult.CREATED, book.put(player, "place_" + index, first),
                    "slot " + index + " created");
        }
        equal(PlaceBook.MAX_PLACES_PER_PLAYER, book.count(player), "place count reaches exact limit");
        equal(PlaceBook.PutResult.LIMIT_REACHED, book.put(player, "overflow", first),
                "seventeenth place rejected");
        equal(null, book.get(player, "overflow"), "rejected place not inserted");
        equal(PlaceBook.PutResult.CREATED, book.put(otherPlayer, "home", first),
                "limits are independent per player");

        List<String> names = book.names(player);
        equal(PlaceBook.MAX_PLACES_PER_PLAYER, names.size(), "all names listed");
        equal(names.stream().sorted(String.CASE_INSENSITIVE_ORDER).toList(), names, "names sorted");
        throwsUnsupported(() -> names.add("mutate"), "name list immutable");

        PlaceBook candidate = book.copy();
        check(candidate.delete(player, "HOME"), "copy deletes case-insensitively");
        equal(updated, book.get(player, "home"), "copy mutation does not change original");
        equal(null, candidate.get(player, "home"), "copy contains its mutation");
        throwsUnsupported(() -> book.snapshot().get(player).put("mutate", first),
                "nested snapshot map immutable");
        check(book.delete(player, "HOME"), "original place deleted");
        check(!book.delete(player, "home"), "delete cannot replay");
    }

    private void placeFileRoundTripsAtomically() throws IOException {
        Path directory = Files.createTempDirectory("server-teleport-place-test-");
        try {
            Path path = directory.resolve("places.properties");
            PlaceFile file = new PlaceFile(path);
            UUID player = id(28);
            SavedPlace home = new SavedPlace(id(200), "world alpha", 1.25D, 65.5D, -3.75D, 91.0F, 12.5F);
            PlaceBook source = new PlaceBook();
            source.put(player, "Home", home);

            file.save(source.snapshot());
            check(Files.isRegularFile(path), "place file created");
            String stored = Files.readString(path);
            check(stored.contains("world-uuid"), "world UUID field persisted");
            check(stored.contains("world-name"), "world name field persisted");
            check(stored.contains(".yaw="), "yaw field persisted");
            check(stored.contains(".pitch="), "pitch field persisted");

            PlaceFile.LoadResult loaded = file.load();
            equal(List.of(), loaded.warnings(), "clean file has no warnings");
            equal(home, loaded.places().get(player, "HOME"), "all place fields round-trip");

            SavedPlace farm = new SavedPlace(id(201), "world", -10, 72, 20, -30, 5);
            source.put(player, "farm", farm);
            file.save(source.snapshot());
            equal(farm, file.load().places().get(player, "farm"), "atomic replacement loads new snapshot");
            try (var children = Files.list(directory)) {
                equal(1L, children.count(), "successful replacement leaves no temporary file");
            }

            String lastGood = Files.readString(path);
            LinkedHashMap<String, SavedPlace> tooMany = new LinkedHashMap<>();
            for (int index = 0; index <= PlaceBook.MAX_PLACES_PER_PLAYER; index++) {
                tooMany.put("p" + index, home);
            }
            throwsIllegalArgument(() -> {
                try {
                    file.save(Map.of(player, tooMany));
                } catch (IOException unexpected) {
                    throw new AssertionError(unexpected);
                }
            }, "oversized snapshot rejected before replacement");
            equal(lastGood, Files.readString(path), "failed validation preserves last good file");

            Files.writeString(path, lastGood
                    + System.lineSeparator() + "unknown.property=value"
                    + System.lineSeparator() + "places." + player + ".broken.x=1"
                    + System.lineSeparator());
            PlaceFile.LoadResult recovered = file.load();
            equal(home, recovered.places().get(player, "home"), "valid place survives malformed neighbors");
            equal(2, recovered.warnings().size(), "malformed properties reported without failing load");
        } finally {
            try (var paths = Files.walk(directory)) {
                paths.sorted((left, right) -> right.compareTo(left)).forEach(path -> {
                    try {
                        Files.deleteIfExists(path);
                    } catch (IOException error) {
                        throw new RuntimeException(error);
                    }
                });
            }
        }
    }

    private void invalidCoreInputsAreRejected() {
        MutableClock clock = new MutableClock();
        throwsIllegalArgument(() -> new RequestBook(clock, 4_999L, 0L, 1), "short expiry rejected");
        throwsIllegalArgument(() -> new RequestBook(clock, 5_000L, -1L, 1), "negative cooldown rejected");
        throwsIllegalArgument(() -> new RequestBook(clock, 5_000L, 0L, 0), "zero incoming limit rejected");
        throwsIllegalArgument(() -> new TeleportRequest(
                id(23), "Bad Name", id(24), "Sam", 1L, 2L), "unsafe player name rejected");
        throwsIllegalArgument(() -> new TeleportRequest(
                id(23), "Alex", id(23), "Alex", 1L, 2L), "same participant rejected");
    }

    private void throwsIllegalArgument(Runnable action, String message) {
        assertions++;
        try {
            action.run();
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError(message);
    }

    private void throwsUnsupported(Runnable action, String message) {
        assertions++;
        try {
            action.run();
        } catch (UnsupportedOperationException expected) {
            return;
        }
        throw new AssertionError(message);
    }

    private void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private void equal(Object expected, Object actual, String message) {
        assertions++;
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    private static UUID id(long value) {
        return new UUID(0L, value);
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
