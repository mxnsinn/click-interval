package com.clickinterval.endlock;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicLong;
import static com.clickinterval.endlock.EndLockState.Domain.END;
import static com.clickinterval.endlock.EndLockState.Domain.NETHER;
import static org.junit.jupiter.api.Assertions.*;

final class EndLockStateTest {
    @TempDir Path root;

    @Test void defaultsLockedAndBothConsoleChoicesPersistAcrossReload() throws Exception {
        Path file = root.resolve("world/server-end-lock/state.properties");
        EndLockState state = new EndLockState(file);
        assertTrue(state.locked());
        assertFalse(state.locked(NETHER));
        assertTrue(state.eyeCraftingBlocked());
        assertTrue(state.frameInsertionBlocked());
        assertEquals(-1, state.remaining(END));
        assertEquals(0, state.remaining(NETHER));
        assertTrue(Files.isRegularFile(file));
        state.setLocked(false);
        assertFalse(new EndLockState(file).locked());
        state.setLocked(true);
        assertTrue(new EndLockState(file).locked());
        assertTrue(state.error().isEmpty());
    }

    @Test void corruptAndOversizedStateFailClosedWithoutOverwritingEvidence() throws Exception {
        Path file = root.resolve("state.properties");
        for (String invalid : new String[]{"", "locked=false", "version=2\nlocked=false\n", "x".repeat(1024)}) {
            Files.writeString(file, invalid);
            EndLockState state = new EndLockState(file);
            assertTrue(state.locked());
            assertTrue(state.locked(NETHER));
            assertTrue(state.eyeCraftingBlocked());
            assertTrue(state.frameInsertionBlocked());
            assertFalse(state.error().isEmpty());
            assertFalse(state.refresh(Long.MAX_VALUE));
            assertEquals(invalid, Files.readString(file));
        }
    }

    @Test void failedUnlockCannotPublishUnlockedMemoryAndFailedRelockFailsClosed() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file);
        state.setLocked(false);
        Files.delete(file);
        Files.createDirectory(file);
        Files.writeString(file.resolve("block-replacement"), "fixture");
        assertThrows(IOException.class, () -> state.setLocked(true));
        assertTrue(state.locked());
        assertTrue(state.locked(NETHER));
        assertThrows(IOException.class, () -> state.setLocked(false));
        assertTrue(state.locked());
        assertFalse(state.error().isEmpty());
    }

    @Test void unwritableParentAndSeparateWorldsNeverShareUnlockedState() throws Exception {
        Path blocker = root.resolve("not-a-directory");
        Files.writeString(blocker, "fixture");
        EndLockState broken = new EndLockState(blocker.resolve("state.properties"));
        assertTrue(broken.locked());
        assertTrue(broken.locked(NETHER));
        assertThrows(IOException.class, () -> broken.setLocked(false));
        EndLockState first = new EndLockState(root.resolve("world-a/state.properties"));
        first.setLocked(false);
        assertTrue(new EndLockState(root.resolve("world-b/state.properties")).locked());
        assertFalse(new EndLockState(root.resolve("world-a/state.properties")).locked());
    }

    @Test void linkedStateFailsClosedWithoutFollowingUnlockedTarget() throws Exception {
        Path target = root.resolve("actual.properties");
        new EndLockState(target).setLocked(false);
        Path linked = root.resolve("linked.properties");
        try {
            Files.createSymbolicLink(linked, target);
        } catch (IOException | UnsupportedOperationException unavailable) {
            org.junit.jupiter.api.Assumptions.abort("Symbolic links unavailable in this test environment");
        }
        EndLockState state = new EndLockState(linked);
        assertTrue(state.locked());
        assertTrue(state.locked(NETHER));
        assertThrows(IOException.class, () -> state.setLocked(false));
        assertFalse(new EndLockState(target).locked(), "linked target must not be overwritten");
    }

    @Test void exactLegacyFilesKeepEndChoiceAndDefaultNetherOpenWithoutReadMigration() throws Exception {
        Path file = root.resolve("state.properties");
        for (boolean locked : new boolean[]{true, false}) {
            for (String newline : new String[]{"\n", "\r\n"}) {
                String legacy = "version=1" + newline + "locked=" + locked + newline;
                Files.writeString(file, legacy);
                EndLockState state = new EndLockState(file, () -> 100_000);
                assertEquals(locked, state.locked());
                assertFalse(state.locked(NETHER));
                assertEquals(0, state.unlockAtMillis(END));
                assertEquals(0, state.unlockAtMillis(NETHER));
                assertTrue(state.eyeCraftingBlocked());
                assertTrue(state.frameInsertionBlocked());
                assertEquals("", state.error());
                assertEquals(legacy, Files.readString(file));
            }
        }
    }

    @Test void legacyMigrationOnExplicitSavePreservesOtherSettings() throws Exception {
        Path file = root.resolve("state.properties");
        Files.writeString(file, "version=1\nlocked=false\n");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(NETHER, DurationSpec.parseMillis("2d"), 100_000);
        EndLockState reloaded = new EndLockState(file, () -> 100_001);
        assertFalse(reloaded.locked());
        assertTrue(reloaded.locked(NETHER));
        assertEquals(100_000 + DurationSpec.parseMillis("2d"), reloaded.unlockAtMillis(NETHER));
        assertTrue(Files.readString(file).startsWith("version=2\n"));
    }

    @Test void independentDeadlinesAndFlagsSurviveRestart() throws Exception {
        Path file = root.resolve("state.properties");
        AtomicLong clock = new AtomicLong(1_000_000);
        EndLockState state = new EndLockState(file, clock::get);
        state.lockFor(END, 20_000);
        state.lockFor(NETHER, 30_000);
        state.setEyeCraftingBlocked(false);
        state.setFrameInsertionBlocked(false);
        clock.addAndGet(5_000);
        EndLockState reloaded = new EndLockState(file, clock::get);
        assertEquals(15_000, reloaded.remaining(END));
        assertEquals(25_000, reloaded.remaining(NETHER));
        assertFalse(reloaded.eyeCraftingBlocked());
        assertFalse(reloaded.frameInsertionBlocked());
        assertTrue(reloaded.locked(END));
        assertTrue(reloaded.locked(NETHER));
        clock.set(1_020_000);
        assertTrue(reloaded.refresh());
        assertFalse(reloaded.locked(END));
        assertTrue(reloaded.locked(NETHER));
        assertEquals(10_000, reloaded.remaining(NETHER));
        assertFalse(reloaded.eyeCraftingBlocked());
        assertFalse(reloaded.frameInsertionBlocked());
        EndLockState secondReload = new EndLockState(file, clock::get);
        assertFalse(secondReload.locked());
        assertTrue(secondReload.locked(NETHER));
    }

    @Test void elapsedReadStaysClosedUntilSuccessfulExplicitRefresh() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 10_000);
        state.lockFor(END, 1_000, 10_000);
        String timed = Files.readString(file);
        assertFalse(state.refresh(10_999));
        assertEquals(1, state.remaining(END, 10_999));
        assertTrue(state.locked(END, 11_000));
        assertTrue(state.locked());
        assertEquals(0, state.remaining(END, 11_000));
        assertEquals(timed, Files.readString(file), "read checks cannot perform persistence retries");
        assertTrue(state.refresh(11_000));
        assertFalse(state.locked());
        assertEquals(0, state.unlockAtMillis(END));
        assertEquals(0, state.remaining(END, 11_000));
        assertFalse(state.refresh(11_001));
        assertFalse(new EndLockState(file, () -> 11_001).locked());
    }

    @Test void offlineTimeCountsAndStartupPersistsDueExpiry() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        state.lockFor(NETHER, 2_000, 100_000);
        EndLockState afterDowntime = new EndLockState(file, () -> 1_000_000);
        assertFalse(afterDowntime.locked(END));
        assertFalse(afterDowntime.locked(NETHER));
        assertEquals(0, afterDowntime.unlockAtMillis(END));
        assertEquals(0, afterDowntime.unlockAtMillis(NETHER));
        // Reloading with an earlier clock still sees the durable unlocked state.
        EndLockState persisted = new EndLockState(file, () -> 100_000);
        assertFalse(persisted.locked(END));
        assertFalse(persisted.locked(NETHER));
    }

    @Test void manualCommandsCancelOnlyTheirDomainTimer() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        state.lockFor(NETHER, 2_000, 100_000);
        state.setLocked(true);
        assertEquals(0, state.unlockAtMillis(END));
        assertEquals(-1, state.remaining(END, Long.MAX_VALUE));
        assertEquals(102_000, state.unlockAtMillis(NETHER));
        assertTrue(state.refresh(Long.MAX_VALUE));
        assertTrue(state.locked(END));
        assertFalse(state.locked(NETHER));
        state.lockFor(END, 1_000, 200_000);
        state.setLocked(false);
        assertEquals(0, state.unlockAtMillis(END));
        assertEquals(0, state.remaining(END, 200_000));
        assertFalse(state.refresh(Long.MAX_VALUE));
        assertFalse(state.locked());
    }

    @Test void replacementTimerStartsFromNewWallClockAndDoesNotAddToOldDeadline() throws Exception {
        EndLockState state = new EndLockState(root.resolve("state.properties"), () -> 100_000);
        state.lockFor(END, 20_000, 100_000);
        state.lockFor(END, 1_000, 105_000);
        assertEquals(106_000, state.unlockAtMillis(END));
        assertEquals(1_000, state.remaining(END, 105_000));
        assertTrue(state.refresh(106_000));
        assertFalse(state.locked());
    }

    @Test void backwardsClockCannotExpireOrOverflowCountdown() throws Exception {
        EndLockState state = new EndLockState(root.resolve("state.properties"), () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        assertFalse(state.refresh(1_000));
        assertTrue(state.locked());
        assertEquals(100_000, state.remaining(END, 1_000));
        assertEquals(Long.MAX_VALUE, state.remaining(END, Long.MIN_VALUE));
        assertFalse(state.refresh(Long.MIN_VALUE));
    }

    @Test void invalidDurationsAndEpochOverflowDoNotMutateState() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.setLocked(false);
        String before = Files.readString(file);
        for (long millis : new long[]{Long.MIN_VALUE, -1, 0, 999, DurationSpec.MAX_MILLIS + 1, Long.MAX_VALUE}) {
            assertThrows(IllegalArgumentException.class, () -> state.lockFor(END, millis, 100_000));
        }
        assertThrows(IllegalArgumentException.class, () -> state.lockFor(END, 1_000, Long.MAX_VALUE - 999));
        assertThrows(IllegalArgumentException.class, () -> state.lockFor(END, 1_000, -1));
        assertFalse(state.locked());
        assertEquals("", state.error());
        assertEquals(before, Files.readString(file));
        state.lockFor(END, DurationSpec.MAX_MILLIS, 100_000);
        assertEquals(DurationSpec.MAX_MILLIS, state.remaining(END, 100_000));
    }

    @Test void corruptVersionTwoFailsClosedWithoutDiscardingEvidence() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState original = new EndLockState(file, () -> 100_000);
        original.setLocked(false);
        original.setEyeCraftingBlocked(false);
        original.setFrameInsertionBlocked(false);
        String valid = Files.readString(file);
        for (String invalid : new String[]{
                valid.replace("version=2", "version=3"),
                valid.replace("end.locked=false", "end.locked=False"),
                valid.replace("end.unlockAtMillis=0", "end.unlockAtMillis=-1"),
                valid.replace("end.unlockAtMillis=0", "end.unlockAtMillis=+1"),
                valid.replace("end.unlockAtMillis=0", "end.unlockAtMillis=00"),
                valid.replace("end.unlockAtMillis=0", "end.unlockAtMillis=1000"),
                valid.replace("nether.unlockAtMillis=0", "nether.unlockAtMillis=9223372036854775808"),
                valid.replace("nether.locked=false\n", ""),
                valid.replace("eyeCraftingBlocked=false", "eyeCraftingBlocked=0"),
                valid.replace("frameInsertionBlocked=false", "frameInsertionBlocked="),
                valid + "end.locked=false\n", valid.stripTrailing(), valid + "\n"}) {
            Files.writeString(file, invalid);
            EndLockState state = new EndLockState(file, () -> 100_000);
            assertTrue(state.locked(END), invalid);
            assertTrue(state.locked(NETHER), invalid);
            assertTrue(state.eyeCraftingBlocked());
            assertTrue(state.frameInsertionBlocked());
            assertFalse(state.error().isEmpty());
            assertFalse(state.refresh(Long.MAX_VALUE));
            assertEquals(invalid, Files.readString(file));
        }
    }

    @Test void versionTwoWindowsNewlinesLoadNormally() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(NETHER, 20_000, 100_000);
        state.setEyeCraftingBlocked(false);
        Files.writeString(file, Files.readString(file).replace("\n", "\r\n"));
        EndLockState reloaded = new EndLockState(file, () -> 101_000);
        assertEquals(19_000, reloaded.remaining(NETHER));
        assertFalse(reloaded.eyeCraftingBlocked());
        assertEquals("", reloaded.error());
    }

    @Test void failedExpiryStaysClosedAndRetriesOnlyOnRefresh() throws Exception {
        Path file = root.resolve("state.properties");
        Path saved = root.resolve("saved.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        Files.move(file, saved);
        Files.createDirectory(file);
        assertFalse(state.refresh(101_000));
        assertTrue(state.locked(END, 101_000));
        assertTrue(state.locked(NETHER, 101_000));
        assertEquals(0, state.remaining(END, 101_000));
        assertEquals(101_000, state.unlockAtMillis(END), "failed expiry retains retry deadline");
        assertFalse(state.error().isEmpty());
        Files.delete(file);
        Files.move(saved, file);
        String beforeRetry = Files.readString(file);
        assertTrue(state.locked(END, 101_000), "restoring storage cannot bypass explicit refresh");
        assertEquals(beforeRetry, Files.readString(file));
        assertTrue(state.refresh(101_000));
        assertFalse(state.locked(END));
        assertTrue(state.locked(NETHER), "the unrelated dimension remains conservatively closed after a storage failure");
        assertEquals("", state.error());
        assertFalse(new EndLockState(file, () -> 101_000).locked());
        try (var children = Files.list(root)) {
            assertTrue(children.noneMatch(path -> path.getFileName().toString().startsWith(".end-lock-")));
        }
    }

    @Test void failedSimultaneousExpiryNeverPartiallyOpensEitherDomain() throws Exception {
        Path file = root.resolve("state.properties");
        Path saved = root.resolve("saved.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        state.lockFor(NETHER, 1_000, 100_000);
        Files.move(file, saved);
        Files.createDirectory(file);
        assertFalse(state.refresh(101_000));
        assertTrue(state.locked(END));
        assertTrue(state.locked(NETHER));
        assertEquals(101_000, state.unlockAtMillis(END));
        assertEquals(101_000, state.unlockAtMillis(NETHER));
        Files.delete(file);
        Files.move(saved, file);
        assertTrue(state.refresh(101_000));
        assertFalse(state.locked(END));
        assertFalse(state.locked(NETHER));
        EndLockState reloaded = new EndLockState(file, () -> 101_000);
        assertFalse(reloaded.locked(END));
        assertFalse(reloaded.locked(NETHER));
    }

    @Test void failedManualRelockCancelsOldTimerAndFailsClosed() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.lockFor(END, 1_000, 100_000);
        state.setEyeCraftingBlocked(false);
        state.setFrameInsertionBlocked(false);
        Files.delete(file);
        Files.createDirectory(file);
        assertThrows(IOException.class, () -> state.setLocked(true));
        assertTrue(state.locked(END));
        assertTrue(state.locked(NETHER));
        assertEquals(0, state.unlockAtMillis(END));
        assertTrue(state.eyeCraftingBlocked());
        assertTrue(state.frameInsertionBlocked());
        assertFalse(state.refresh(Long.MAX_VALUE), "a failed manual relock must not later reopen via its former timer");
    }

    @Test void failedConfigurationWritesReenableBothProtections() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 100_000);
        state.setLocked(false);
        state.setEyeCraftingBlocked(false);
        state.setFrameInsertionBlocked(false);
        Files.delete(file);
        Files.createDirectory(file);
        assertThrows(IOException.class, () -> state.setEyeCraftingBlocked(false));
        assertTrue(state.locked(END));
        assertTrue(state.locked(NETHER));
        assertTrue(state.eyeCraftingBlocked());
        assertTrue(state.frameInsertionBlocked());
        assertThrows(IOException.class, () -> state.setFrameInsertionBlocked(false));
        assertTrue(state.frameInsertionBlocked());
    }

    @Test void linkedParentIsRejectedBeforeReadingOrWritingTarget() throws Exception {
        Path target = Files.createDirectory(root.resolve("actual"));
        Path file = target.resolve("state.properties");
        new EndLockState(file).setLocked(false);
        String before = Files.readString(file);
        Path linked = root.resolve("linked");
        try {
            Files.createSymbolicLink(linked, target);
        } catch (IOException | UnsupportedOperationException unavailable) {
            org.junit.jupiter.api.Assumptions.abort("Symbolic links unavailable in this test environment");
        }
        EndLockState state = new EndLockState(linked.resolve("state.properties"));
        assertTrue(state.locked(END));
        assertTrue(state.locked(NETHER));
        assertThrows(IOException.class, () -> state.setLocked(NETHER, false));
        assertEquals(before, Files.readString(file));
    }
}
