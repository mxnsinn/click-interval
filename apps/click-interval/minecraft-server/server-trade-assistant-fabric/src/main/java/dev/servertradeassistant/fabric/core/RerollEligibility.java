package dev.servertradeassistant.fabric.core;

/** Side-effect-free validation used before any inventory or trade mutation. */
public final class RerollEligibility {
    public enum Denial {
        NONE,
        NOT_EMPLOYED,
        NOT_NOVICE,
        ALREADY_TRADED,
        LIMIT_REACHED
    }

    private RerollEligibility() { }

    public static Denial evaluate(boolean employed, int villagerLevel, int villagerXp,
            boolean anyOfferUsed, int rerollCount, int maximumRerolls) {
        if (!employed) return Denial.NOT_EMPLOYED;
        if (villagerLevel != 1 || villagerXp != 0) return Denial.NOT_NOVICE;
        if (anyOfferUsed) return Denial.ALREADY_TRADED;
        if (maximumRerolls > 0 && rerollCount >= maximumRerolls) return Denial.LIMIT_REACHED;
        return Denial.NONE;
    }
}
