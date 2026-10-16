package com.clickinterval.endlock;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;
import static com.clickinterval.endlock.EndLockState.Domain.*;

final class LaunchScheduleTest {
    @TempDir Path root;
    private static final long DAY = 86_400_000L;

    @Test void offlineReadsDoNotStartTimersAndBothStartAtReadyTimeOnlyOnce() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 1000);
        state.armForNextLaunch(2 * DAY, 3 * DAY);
        String armed = Files.readString(file);
        EndLockState read = new EndLockState(file, () -> 10 * DAY);
        assertEquals(armed, Files.readString(file));
        assertEquals(0, read.unlockAtMillis(NETHER));
        assertEquals(2 * DAY, read.startOnLaunchMillis(NETHER));
        assertEquals(3 * DAY, read.startOnLaunchMillis(END));
        assertFalse(read.refresh(Long.MAX_VALUE));
        long opened = 20 * DAY;
        assertTrue(read.startPendingTimers(opened));
        assertEquals(opened + 2 * DAY, read.unlockAtMillis(NETHER));
        assertEquals(opened + 3 * DAY, read.unlockAtMillis(END));
        assertEquals(0, read.startOnLaunchMillis(NETHER));
        assertEquals(0, read.startOnLaunchMillis(END));
        String started = Files.readString(file);
        assertFalse(read.startPendingTimers(opened + DAY));
        assertEquals(started, Files.readString(file));
        EndLockState restart = new EndLockState(file, () -> opened + DAY);
        assertFalse(restart.startPendingTimers(opened + DAY));
        assertEquals(DAY, restart.remaining(NETHER));
        assertEquals(2 * DAY, restart.remaining(END));
        assertTrue(restart.refresh(opened + 2 * DAY));
        assertFalse(restart.locked(NETHER));
        assertTrue(restart.locked(END));
        assertTrue(restart.refresh(opened + 3 * DAY));
        assertFalse(restart.locked(END));
        assertEquals(0, restart.openingDurationMillis(END));
    }

    @Test void manualOverrideCancelsOnlyThatDomainsPendingStart() throws Exception {
        EndLockState state = new EndLockState(root.resolve("state.properties"), () -> 1000);
        state.armForNextLaunch(2 * DAY, 3 * DAY);
        state.setLocked(NETHER, false);
        assertTrue(state.startPendingTimers(10_000));
        assertFalse(state.locked(NETHER));
        assertEquals(0, state.startOnLaunchMillis(NETHER));
        assertEquals(0, state.openingDurationMillis(NETHER));
        assertEquals(10_000 + 3 * DAY, state.unlockAtMillis(END));
    }

    @Test void failedStartNeverPartiallyOpensOrConsumesPendingState() throws Exception {
        Path file = root.resolve("state.properties"), saved = root.resolve("saved.properties");
        EndLockState state = new EndLockState(file, () -> 1000);
        state.armForNextLaunch(2 * DAY, 3 * DAY);
        Files.move(file, saved);
        Files.createDirectory(file);
        assertFalse(state.startPendingTimers(10_000));
        assertTrue(state.locked(END)); assertTrue(state.locked(NETHER));
        assertEquals(0, state.unlockAtMillis(END)); assertEquals(3 * DAY, state.startOnLaunchMillis(END));
        assertFalse(state.error().isEmpty());
        Files.delete(file); Files.move(saved, file);
        assertTrue(state.startPendingTimers(20_000));
        assertEquals(20_000 + 2 * DAY, state.unlockAtMillis(NETHER));
        assertEquals(20_000 + 3 * DAY, state.unlockAtMillis(END));
    }

    @Test void malformedPendingStateFailsClosedWithoutOverwritingEvidence() throws Exception {
        Path file = root.resolve("state.properties");
        EndLockState state = new EndLockState(file, () -> 1000);
        state.armForNextLaunch(2 * DAY, 3 * DAY);
        String valid = Files.readString(file);
        for (String invalid : new String[]{
                valid.replace("nether.locked=true", "nether.locked=false"),
                valid.replace("end.unlockAtMillis=0", "end.unlockAtMillis=10000"),
                valid.replace("nether.startOnLaunchMillis=172800000", "nether.startOnLaunchMillis=-1"),
                valid.replace("end.openingDurationMillis=259200000", "end.openingDurationMillis=0"),
                valid.replace("end.startOnLaunchMillis=259200000", "end.startOnLaunchMillis=9223372036854775807")}) {
            Files.writeString(file, invalid);
            EndLockState broken = new EndLockState(file, () -> 1000);
            assertTrue(broken.locked(END)); assertTrue(broken.locked(NETHER));
            assertFalse(broken.error().isEmpty());
            assertFalse(broken.startPendingTimers(Long.MAX_VALUE));
            assertEquals(invalid, Files.readString(file));
        }
    }

    @Test void overflowStartKeepsBothPendingAndClosed() throws Exception {
        EndLockState state = new EndLockState(root.resolve("state.properties"), () -> 1000);
        state.armForNextLaunch(2 * DAY, 3 * DAY);
        assertFalse(state.startPendingTimers(Long.MAX_VALUE - DAY));
        assertEquals(0, state.unlockAtMillis(NETHER)); assertEquals(0, state.unlockAtMillis(END));
        assertTrue(state.locked(NETHER)); assertTrue(state.locked(END));
        assertEquals(2 * DAY, state.startOnLaunchMillis(NETHER));
        assertFalse(state.error().isEmpty());
    }
}
