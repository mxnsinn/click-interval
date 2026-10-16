package com.clickinterval.villagertrades.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class CycleButtonStateTest {
    @Test void hiddenUntilServerConfirmsThisMenuAndReinitDoesNotDuplicateQuery() {
        var state = new CycleButtonState(12);
        assertFalse(state.visible(true, 0, 1, true, false));
        assertFalse(state.accept(12, 7, true), "unsolicited state is ignored");
        assertFalse(state.queryIfDue(false, true, 0));
        assertTrue(state.queryIfDue(true, true, 0));
        assertFalse(state.queryIfDue(true, true, 0), "GUI resize must not resend initial query");
        assertFalse(state.accept(11, 7, true));
        assertFalse(state.accept(12, 0, true));
        assertFalse(state.visible(true, 0, 1, true, false));
        assertTrue(state.accept(12, 7, true));
        assertTrue(state.visible(true, 0, 1, true, false));
        assertFalse(state.queryIfDue(true, true, 60000), "confirmed screen needs no periodic traffic");
        assertTrue(state.visible(true, 0, 1, true, false), "re-init retains confirmed eligibility");
    }
    @Test void tradedUnknownAndUnsupportedMerchantsNeverShowAButton() {
        var state = confirmed();
        assertFalse(state.visible(false, 0, 1, true, false));
        assertFalse(state.visible(true, 1, 1, true, false));
        assertFalse(state.visible(true, 0, 2, true, false));
        assertFalse(state.visible(true, 0, 1, false, false));
        assertFalse(state.visible(true, 0, 1, true, true));
        assertTrue(state.accept(12, 8, false));
        assertFalse(state.visible(true, 0, 1, true, false));
    }
    @Test void pendingAndCooldownPreventDoubleRequestsAndDuplicatesDoNotReleasePending() {
        var state = confirmed();
        assertTrue(state.begin(true, true, 1000));
        assertTrue(state.pending());
        assertFalse(state.begin(true, true, 2000));
        assertFalse(state.accept(12, 7, true), "old nonce cannot acknowledge current request");
        assertTrue(state.pending());
        assertTrue(state.accept(12, -91, true), "all nonzero random long values are valid");
        assertFalse(state.pending());
        assertEquals(-91, state.nonce());
        assertFalse(state.enabled(true, true, 1549));
        assertTrue(state.enabled(true, true, 1550));
    }
    @Test void paymentResultAndCursorGuardAreRecheckedAtClick() {
        var state = confirmed();
        assertFalse(state.begin(true, false, 1000));
        assertFalse(state.pending());
        assertFalse(state.begin(false, true, 1000));
        assertTrue(state.begin(true, true, 1000));
        assertTrue(state.accept(12, 8, false));
        assertFalse(state.visible(true, 0, 1, true, false));
    }
    @Test void newScreenNeverInheritsEligibilityOrNonceFromOldScreen() {
        var old = confirmed(); old.begin(true, true, 1000);
        var next = new CycleButtonState(13);
        assertEquals(0, next.nonce()); assertFalse(next.pending());
        next.queryIfDue(true, true, 0);
        assertFalse(next.accept(12, 8, true));
        assertFalse(next.visible(true, 0, 1, true, false));
    }
    private CycleButtonState confirmed() {
        var state = new CycleButtonState(12);
        state.queryIfDue(true, true, 0); assertTrue(state.accept(12, 7, true)); return state;
    }

    @Test void channelAndOfferAvailabilityAfterInitCanStartHandshakeWithoutReopening() {
        var state = new CycleButtonState(12);
        assertFalse(state.queryIfDue(false, false, 0));
        assertFalse(state.queryIfDue(true, false, 100));
        assertFalse(state.queryIfDue(false, true, 200));
        assertTrue(state.queryIfDue(true, true, 300));
        assertTrue(state.accept(12, 7, true));
        assertTrue(state.visible(true, 0, 1, true, false));
    }

    @Test void missingInitialReplyRetriesAtBoundedRateAndLateReplyStillConfirms() {
        var state = new CycleButtonState(12);
        int sent = 0;
        for (int now = 0; now < 60000; now++) if (state.queryIfDue(true, true, now)) sent++;
        assertEquals(40, sent, "never per-frame network polling, even with no response");
        assertFalse(state.visible(true, 0, 1, true, false));
        assertTrue(state.accept(12, 42, true));
        assertTrue(state.visible(true, 0, 1, true, false));
        assertFalse(state.queryIfDue(true, true, 60000));
    }

    @Test void temporaryServerRejectionCanRecoverUsingExistingMenuNonce() {
        var state = new CycleButtonState(12);
        assertTrue(state.queryIfDue(true, true, 0));
        assertTrue(state.accept(12, 7, false));
        assertFalse(state.visible(true, 0, 1, true, false));
        assertFalse(state.accept(12, 7, true), "same nonce is not unsolicited permission");
        assertFalse(state.queryIfDue(true, true, 1499));
        assertTrue(state.queryIfDue(true, true, 1500));
        assertTrue(state.accept(12, 7, true), "query responses retain the server menu nonce");
        assertTrue(state.visible(true, 0, 1, true, false));
        assertFalse(state.accept(12, 7, false), "a delayed duplicate cannot hide a newly confirmed button");
    }

    @Test void repeatedNegativeRepliesDoNotEnableButtonOrFloodServer() {
        var state = new CycleButtonState(12);
        assertTrue(state.queryIfDue(true, true, 0));
        assertTrue(state.accept(12, 7, false));
        assertTrue(state.queryIfDue(true, true, 1500));
        assertTrue(state.accept(12, 7, false));
        assertFalse(state.queryIfDue(true, true, 1500));
        assertFalse(state.queryIfDue(true, true, 2999));
        assertFalse(state.visible(true, 0, 1, true, false));
        assertFalse(state.enabled(false, true, 5000));
    }

    @Test void eligibilityRefreshCannotOverlapOrAcknowledgePendingCycle() {
        var state = confirmed();
        assertTrue(state.begin(true, true, 1000));
        assertFalse(state.queryIfDue(true, true, 60000));
        assertFalse(state.accept(12, 7, false));
        assertTrue(state.pending());
        assertTrue(state.accept(12, 8, false));
        assertFalse(state.pending());
        assertTrue(state.queryIfDue(true, true, 60000));
        assertTrue(state.accept(12, 8, true));
        assertTrue(state.visible(true, 0, 1, true, false));
    }

    @Test void eligibilityBeforeNativeOffersAndTransientSupportStillUsesCurrentNativeFacts() {
        var state = confirmed();
        assertFalse(state.visible(true, 0, 1, false, false));
        assertFalse(state.visible(false, 0, 1, true, false));
        assertTrue(state.visible(true, 0, 1, true, false));
        assertFalse(state.visible(true, 1, 1, true, false));
        assertFalse(state.visible(true, 0, 1, true, true));
    }

    @Test void locallyTradedAndUnsupportedScreensNeverRetryQueries() {
        assertFalse(CycleButtonState.nativeCandidate(1, 1, true, false));
        assertFalse(CycleButtonState.nativeCandidate(0, 2, true, false));
        assertFalse(CycleButtonState.nativeCandidate(0, 1, true, true));
        assertFalse(CycleButtonState.nativeCandidate(0, 1, false, false));
        assertTrue(CycleButtonState.nativeCandidate(0, 1, true, false));
        var state = new CycleButtonState(12);
        for (int now = 0; now <= 60000; now += 1000) {
            assertFalse(state.queryIfDue(false, true, now));
            assertFalse(state.queryIfDue(true, false, now));
        }
        assertEquals(0, state.nonce());
    }
}
