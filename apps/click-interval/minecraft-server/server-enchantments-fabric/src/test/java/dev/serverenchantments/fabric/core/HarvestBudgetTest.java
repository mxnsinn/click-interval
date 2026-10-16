package dev.serverenchantments.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class HarvestBudgetTest {
    @Test void oneTickSharesBreakCreditsAcrossInlineAndQueuedDispatches() {
        HarvestBudget budget=new HarvestBudget(2_000_000);
        budget.reset(1024,32);
        for(int first=0;first<8;first++) assertTrue(budget.tryBreak());
        budget.chargeNanos(100_000);
        for(int later=0;later<24;later++) assertTrue(budget.tryBreak());
        assertFalse(budget.tryBreak());
        assertFalse(budget.tryBreak(),"another same-tick dispatch must not replenish credits");
        assertEquals(0,budget.breaksLeft());
        assertEquals(1_900_000,budget.timeLeftNanos());
    }
    @Test void elapsedDispatchTimeAccumulatesAndCannotUnderflowOrBecomeUnlimited() {
        HarvestBudget budget=new HarvestBudget(2_000_000);
        budget.reset(100,10);
        budget.chargeNanos(500_000);
        assertTrue(budget.hasTime(1_499_999));
        assertFalse(budget.hasTime(1_500_000));
        budget.chargeNanos(Long.MAX_VALUE);
        assertEquals(0,budget.timeLeftNanos());
        assertFalse(budget.hasTime(0));
        budget.chargeNanos(Long.MAX_VALUE);
        assertEquals(0,budget.timeLeftNanos());
    }
    @Test void scanQuantumAndTotalCreditsBoundEveryInspection() {
        HarvestBudget budget=new HarvestBudget(2_000_000);
        budget.reset(35,1);
        assertEquals(32,budget.scanAllowance(32));
        budget.consumeScans(32);
        assertEquals(3,budget.scanAllowance(32));
        budget.consumeScans(3);
        assertEquals(0,budget.scanAllowance(Integer.MAX_VALUE));
        assertThrows(IllegalArgumentException.class,()->budget.consumeScans(1));
        assertThrows(IllegalArgumentException.class,()->budget.consumeScans(-1));
        assertEquals(0,budget.scansLeft());
    }
    @Test void onlyExplicitNextTickResetRestoresTheThreeBudgets() {
        HarvestBudget budget=new HarvestBudget(200);
        budget.reset(2,1);
        budget.consumeScans(2);assertTrue(budget.tryBreak());budget.chargeNanos(200);
        assertEquals(0,budget.scansLeft());assertEquals(0,budget.breaksLeft());assertFalse(budget.hasTime(0));
        budget.reset(5,3);
        assertEquals(5,budget.scansLeft());assertEquals(3,budget.breaksLeft());assertEquals(200,budget.timeLeftNanos());
    }
    @Test void invalidClockAndCountInputsDoNotMintCredits() {
        assertThrows(IllegalArgumentException.class,()->new HarvestBudget(0));
        assertThrows(IllegalArgumentException.class,()->new HarvestBudget(-1));
        HarvestBudget budget=new HarvestBudget(100);
        budget.reset(-1,-20);
        assertEquals(0,budget.scanAllowance(30));assertFalse(budget.tryBreak());
        budget.chargeNanos(-1000);
        assertEquals(100,budget.timeLeftNanos());
        assertEquals(0,budget.scanAllowance(-1));
    }
}
