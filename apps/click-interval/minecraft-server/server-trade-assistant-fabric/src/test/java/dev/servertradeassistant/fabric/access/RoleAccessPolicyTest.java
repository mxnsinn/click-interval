package dev.servertradeassistant.fabric.access;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class RoleAccessPolicyTest {
    private static final UUID ALEX_UUID = UUID.fromString("11111111-1111-4111-8111-111111111111");

    @Test
    void readsExactCapabilitiesDiscountAndAssignment() throws Exception {
        RoleAccessPolicy policy = RoleAccessPolicy.parse("""
                roles:
                  - id: trader
                    tradeDiscountPercent: 23
                    capabilities:
                      - trade.reroll
                      - entity.labels
                      - entity.inspect
                    commandPolicy:
                      mode: allowlist
                      allow: []
                assignments:
                  - player: Alex
                    uuid: "11111111-1111-4111-8111-111111111111"
                    roleId: trader
                """);

        RoleAccessPolicy.Decision decision = policy.decide("Alex", ALEX_UUID, true, 0);
        assertTrue(decision.rerollAllowed());
        assertEquals(23, decision.tradeDiscountPercent());
        assertEquals("trader", decision.roleId());
        assertTrue(policy.hasCapability("Alex", ALEX_UUID, "entity.labels"));
        assertTrue(policy.hasCapability("Alex", ALEX_UUID, "entity.inspect"));
        assertFalse(policy.hasCapability("Alex", ALEX_UUID, "entity.edit"));
    }

    @Test
    void uuidBoundAssignmentCannotBeClaimedByName() throws Exception {
        RoleAccessPolicy policy = RoleAccessPolicy.parse("""
                roles:
                  - id: editor
                    tradeDiscountPercent: 55
                    capabilities:
                      - entity.edit
                assignments:
                  - player: Alex
                    uuid: "11111111-1111-4111-8111-111111111111"
                    roleId: editor
                """);
        UUID impostor = UUID.fromString("22222222-2222-4222-8222-222222222222");
        assertFalse(policy.hasCapability("Alex", impostor, "entity.edit"));
        assertEquals(0, policy.decide("Alex", impostor, false, 0).tradeDiscountPercent());
    }

    @Test
    void rejectsMalformedRoleAndUnknownCapabilities() throws Exception {
        RoleAccessPolicy policy = RoleAccessPolicy.parse("""
                roles:
                  - id: member
                    capabilities:
                      - made.up
                assignments:
                  - player: Alex
                    roleId: member
                """);
        assertFalse(policy.hasCapability("Alex", null, "made.up"));

        try {
            RoleAccessPolicy.parse("roles:\n  - id: ../escape\nassignments: []\n");
        } catch (IOException expected) {
            return;
        }
        throw new AssertionError("Malformed role ID was accepted");
    }
}
