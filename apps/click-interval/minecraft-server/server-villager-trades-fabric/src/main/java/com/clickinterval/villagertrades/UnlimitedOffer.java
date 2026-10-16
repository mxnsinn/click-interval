package com.clickinterval.villagertrades;

/** Transient ownership flag; never written into world data or required on a client. */
public interface UnlimitedOffer {
    void clickInterval$setUnlimited(boolean unlimited);
    boolean clickInterval$isUnlimited();
}
