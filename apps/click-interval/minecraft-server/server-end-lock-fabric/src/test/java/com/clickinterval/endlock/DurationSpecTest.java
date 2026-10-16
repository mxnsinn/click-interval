package com.clickinterval.endlock;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class DurationSpecTest {
    @Test void parsesRequestedUnitsExactly() {
        assertEquals(86_400_000, DurationSpec.parseMillis("1d"));
        assertEquals(172_800_000, DurationSpec.parseMillis("2d"));
        assertEquals(20_000, DurationSpec.parseMillis("20s"));
        assertEquals(1_800_000, DurationSpec.parseMillis("30m"));
        assertEquals(21_600_000, DurationSpec.parseMillis("6h"));
        assertEquals(21_600_000, DurationSpec.parseMillis("6H"));
        assertEquals(1_000, DurationSpec.parseMillis("1s"));
        assertEquals(DurationSpec.MAX_MILLIS, DurationSpec.parseMillis("365d"));
        assertEquals(DurationSpec.MAX_MILLIS, DurationSpec.parseMillis("31536000s"));
    }

    @Test void rejectsMalformedZeroNegativeFractionalAndUnsupportedUnits() {
        for (String invalid : new String[]{"", "0s", "0d", "-1s", "+1s", "1.5h", "1", "s", "1w",
                "1ms", "1h30m", " 1s", "1s ", "1 s", "1\ns", "NaNs", "Infinitys", "１s"}) {
            assertThrows(IllegalArgumentException.class, () -> DurationSpec.parseMillis(invalid), invalid);
        }
        assertThrows(IllegalArgumentException.class, () -> DurationSpec.parseMillis(null));
    }

    @Test void rejectsRangeAndBothNumberAndMultiplicationOverflow() {
        for (String invalid : new String[]{"366d", "31536001s", "8761h", "525601m",
                "9223372036854775807s", "9223372036854775808s", "999999999999999999999999999999999999d"}) {
            assertThrows(IllegalArgumentException.class, () -> DurationSpec.parseMillis(invalid), invalid);
        }
    }

    @Test void countdownUsesCompactUnitsAndCeilsPartialSeconds() {
        assertEquals("indefinite", DurationSpec.formatMillis(-1));
        assertEquals("0s", DurationSpec.formatMillis(0));
        assertEquals("1s", DurationSpec.formatMillis(1));
        assertEquals("1s", DurationSpec.formatMillis(999));
        assertEquals("1s", DurationSpec.formatMillis(1_000));
        assertEquals("2s", DurationSpec.formatMillis(1_001));
        assertEquals("1m", DurationSpec.formatMillis(59_001));
        assertEquals("1m 1s", DurationSpec.formatMillis(60_001));
        assertEquals("6h", DurationSpec.formatMillis(DurationSpec.parseMillis("6h")));
        assertEquals("1d 2h 3m 4s", DurationSpec.formatMillis(93_784_000));
        assertEquals("365d", DurationSpec.formatMillis(DurationSpec.MAX_MILLIS));
        assertEquals("106751991167d 7h 12m 56s", DurationSpec.formatMillis(Long.MAX_VALUE));
        assertThrows(IllegalArgumentException.class, () -> DurationSpec.formatMillis(-2));
    }
}
