package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import net.minecraft.world.phys.AABB;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class BoatSupportTest {
    private static final AABB HULL = new AABB(-0.6875,63.4375,-0.6875,0.6875,64,0.6875);
    private static AABB player(double x,double y,double z) {return new AABB(x-0.3,y,z-0.3,x+0.3,y+1.8,z+0.3);}
    private static MovementAnalyzer.Sample sample(double x,double y,boolean supported,boolean grace) {
        return new MovementAnalyzer.Sample(x,y,0,supported,false,grace,false,false,false,true,false,1,20,1);
    }

    @Test void hullContactDoesNotTrustTheClientGroundBit() throws Exception {
        assertFalse(ServerProtectionFabric.resolveGroundSupport(false,false,true),"old adapter rejected real entity support when packet ground was false");
        ProtectionConfig config=ProtectionConfig.parse("");
        MovementAnalyzer old=new MovementAnalyzer(),fixed=new MovementAnalyzer();boolean reproduced=false;
        for(int tick=0;tick<100;tick++) {
            double y=64+Math.sin(tick*0.25)*0.06;
            boolean contact=BoatSupportProbe.supports(player(0,y,0),HULL);assertTrue(contact);
            reproduced|=old.evaluate(sample(0,y,false,false),config).has(MovementAnalyzer.VERTICAL_FLIGHT);
            assertEquals(0,fixed.evaluate(sample(0,y,contact,false),config).flags());
        }
        assertTrue(reproduced,"baseline accumulates unsupported flight while bobbing on hull");
    }

    @Test void nearbyBelowAboveAndTinyEdgeOverlapAreNotSupport() {
        assertTrue(BoatSupportProbe.supports(player(0,64,0),HULL));
        assertTrue(BoatSupportProbe.supports(player(0,64.10,0),HULL));
        assertTrue(BoatSupportProbe.supports(player(0,63.90,0),HULL));
        assertFalse(BoatSupportProbe.supports(player(2,64,0),HULL));
        assertFalse(BoatSupportProbe.supports(player(0,65,0),HULL));
        assertFalse(BoatSupportProbe.supports(player(0,63.7,0),HULL));
        assertFalse(BoatSupportProbe.supports(player(0.98,64,0),HULL));
        assertFalse(BoatSupportProbe.supports(player(0,Double.NaN,0),HULL));
    }

    @Test void actualHullSupportPreventsGroundSpoofAndWaterWalkButNotNoSlow() {
        BehaviorPatternAnalyzer analyzer=new BehaviorPatternAnalyzer();int flags=0;
        for(int tick=0;tick<30;tick++) {
            flags=analyzer.observeMovement(1000+50L*tick,0,0.1,tick%2==0,true,true,false,false,false,0.6,0.2,5,7,2,7);
            assertEquals(0,flags);
        }
        for(int tick=0;tick<7;tick++)flags=analyzer.observeMovement(3000+50L*tick,0,0.4,true,true,true,false,true,false,0.6,0.2,5,7,2,7);
        assertTrue((flags&BehaviorPatternAnalyzer.NO_SLOW)!=0,"real support does not exempt other movement patterns");
    }

    @Test void standingAndJumpGraceNeverDisableHorizontalSpeed() throws Exception {
        ProtectionConfig config=ProtectionConfig.parse("");MovementAnalyzer analyzer=new MovementAnalyzer();
        analyzer.evaluate(sample(0,64,true,false),config);
        analyzer.evaluate(sample(2,64,true,false),config);
        assertTrue(analyzer.evaluate(sample(4,64,true,false),config).has(MovementAnalyzer.HORIZONTAL_SPEED));
        assertTrue(analyzer.evaluate(sample(6,64.5,false,true),config).has(MovementAnalyzer.HORIZONTAL_SPEED));
    }

    @Test void departureGraceNeedsActualContactAndExpiresAfterTwelveTicks() {
        BoatSupportTracker tracker=new BoatSupportTracker();
        assertFalse(tracker.observe(1,player(0,64,0),false));
        assertFalse(tracker.timerGrace(1));
        assertFalse(tracker.observe(2,player(0,64,0),true));
        for(int tick=3;tick<=14;tick++)assertTrue(tracker.observe(tick,player(0.2,65.2,0),false));
        assertFalse(tracker.observe(15,player(0.2,65.2,0),false));
        assertFalse(tracker.timerGrace(15));
    }

    @Test void departureGraceCannotFollowFarTravelHighFlightOrReturnAfterEscape() {
        for(AABB escape:new AABB[]{player(3,64,0),player(0,65.5,0),player(0,62,0)}) {
            BoatSupportTracker tracker=new BoatSupportTracker();tracker.observe(1,player(0,64,0),true);
            assertFalse(tracker.observe(2,escape,false));assertFalse(tracker.timerGrace(2));
            assertFalse(tracker.observe(3,player(0,64,0),false));
        }
    }

    @Test void continuousSupportCannotRefreshTimerGrace() {
        BoatSupportTracker tracker=new BoatSupportTracker();
        for(int tick=1;tick<=250;tick++) {
            assertFalse(tracker.observe(tick,player(0,64,0),true));
            assertEquals(tick<9,tracker.timerGrace(tick));
        }
    }

    @Test void RapidEdgeTogglingCannotMakeTimerPermanentlyExempt() {
        BoatSupportTracker tracker=new BoatSupportTracker();
        for(int tick=1;tick<100;tick++) {
            tracker.observe(tick,player(0,64,0),tick%2==1);
            assertEquals(tick<9,tracker.timerGrace(tick));
        }
    }

    @Test void LaterDepartureCanEarnOnlyOneBoundedCorrectionWindow() {
        BoatSupportTracker tracker=new BoatSupportTracker();
        for(int tick=1;tick<=150;tick++)tracker.observe(tick,player(0,64,0),true);
        for(int tick=151;tick<=163;tick++) {
            tracker.observe(tick,player(0.2,64.1,0),false);
            assertEquals(tick<159,tracker.timerGrace(tick));
        }
        tracker.reset();assertFalse(tracker.timerGrace(163));assertFalse(tracker.observe(164,player(0,64,0),false));
    }

    @Test void UnsupportedWaterWalkAndHoverRemainDetectableAwayFromBoats() throws Exception {
        BehaviorPatternAnalyzer behavior=new BehaviorPatternAnalyzer();MovementAnalyzer movement=new MovementAnalyzer();
        ProtectionConfig config=ProtectionConfig.parse("");boolean water=false,flight=false;
        for(int tick=0;tick<120;tick++) {
            AABB box=player(5+tick*0.1,64,0);boolean supported=BoatSupportProbe.supports(box,HULL);assertFalse(supported);
            water|=(behavior.observeMovement(1000+tick*50L,0,0.1,false,supported,true,false,false,false,0.6,0.2,5,7,2,7)&BehaviorPatternAnalyzer.WATER_WALK)!=0;
            flight|=movement.evaluate(sample(5+tick*0.1,64,supported,false),config).has(MovementAnalyzer.VERTICAL_FLIGHT);
        }
        assertTrue(water);assertTrue(flight);
    }
}
