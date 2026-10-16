package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class MovementCorrectionTrackerTest {
    private static MovementCorrectionTracker issued() {var t=new MovementCorrectionTracker();t.issued(1000,7,1,64,2,45,10);return t;}
    private static boolean response(MovementCorrectionTracker t,long now) {return t.consume(now,true,false,false,1,64,2,45,10);}

    @Test void requiresServerIssueAndValidatedMatchingAcknowledgment() {
        var empty=new MovementCorrectionTracker();empty.acknowledged(1000,7);assertFalse(response(empty,1001));
        var t=issued();assertFalse(response(t,1001));t.acknowledged(1002,8);assertFalse(response(t,1003));
        t.acknowledged(1004,7);assertTrue(response(t,1005));assertFalse(response(t,1006));
    }
    @Test void mismatchedPositionConsumesRatherThanSavingTokenForReplay() {
        var t=issued();t.acknowledged(1050,7);
        assertFalse(t.consume(1051,true,false,false,1.01,64,2,45,10));assertFalse(response(t,1052));
    }
    @Test void onlyExactVanillaExtraPacketShapeQualifies() {
        for(int shape=0;shape<4;shape++) {
            var t=issued();t.acknowledged(1050,7);
            assertFalse(t.consume(1051,shape!=0,shape==1,shape==2,1,64,2,shape==3?46:45,10));
            assertFalse(response(t,1052));
        }
    }
    @Test void expiryAndClockRegressionNeverGrantAllowance() {
        for(long ack:new long[]{999,3001}) {var t=issued();t.acknowledged(ack,7);assertFalse(response(t,ack+1));}
        for(long consume:new long[]{1049,1301}) {var t=issued();t.acknowledged(1050,7);assertFalse(response(t,consume));}
    }
    @Test void duplicateAcknowledgmentCannotRefreshTokenOrDeadline() {
        var t=issued();t.acknowledged(1050,7);t.acknowledged(1250,7);assertFalse(response(t,1301));
        t=issued();t.acknowledged(1050,7);assertTrue(response(t,1051));t.acknowledged(1052,7);assertFalse(response(t,1053));
    }
    @Test void replacementCorrectionInvalidatesPreviousIdAndCoordinates() {
        var t=issued();t.acknowledged(1010,7);t.issued(1020,8,2,65,3,0,0);t.acknowledged(1021,7);
        assertFalse(response(t,1022));t.acknowledged(1023,8);
        assertTrue(t.consume(1024,true,false,false,2,65,3,0,0));assertFalse(response(t,1025));
    }
    @Test void finiteCoordinatesAndRotationWrappingAreChecked() {
        var t=issued();t.acknowledged(1010,7);assertFalse(t.consume(1011,true,false,false,Double.NaN,64,2,45,10));
        t=issued();t.acknowledged(1010,7);assertTrue(t.consume(1011,true,false,false,1,64,2,405,10));
    }
    @Test void twentyNormalTicksPlusTwentyGenuineResponsesDoNotBecomeFortyTickTimer() {
        assertEquals(0,replay(1));
        assertTrue(replay(2)>0,"40 real normal packets/s still trigger despite extra acknowledged correction responses");
    }
    private static int replay(int normalPerTick) {
        var t=new MovementCorrectionTracker();var timer=new BehaviorPatternAnalyzer();int flags=0;
        for(int tick=0;tick<200;tick++) {
            long now=1000+tick*50L;
            for(int n=0;n<normalPerTick;n++)flags|=timer.observeMovementPacket(now+n,25,2,false);
            t.issued(now+2,tick,1,64,2,45,10);t.acknowledged(now+3,tick);
            assertTrue(response(t,now+4)); // The adapter skips only this verified extra packet, without reset.
        }
        return flags;
    }
}
