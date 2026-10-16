package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetSocketAddress;
import org.junit.jupiter.api.Test;

final class HostnameAdmissionPolicyTest {
  private static final String DOMAIN = "mxnsinn-smp.net";
  private static final InetSocketAddress PUBLIC_PEER = new InetSocketAddress("192.0.2.4", 48000);
  private static final InetSocketAddress LOCAL_PEER = new InetSocketAddress("127.0.0.1", 48000);

  @Test
  void disabledPolicyPreservesAllExistingLoginAddresses() {
    assertTrue(HostnameAdmissionPolicy.allows("", null, PUBLIC_PEER));
    assertTrue(HostnameAdmissionPolicy.allows("", "86.97.163.169", PUBLIC_PEER));
  }

  @Test
  void acceptsExactDomainCaseAndFinalDotVariants() {
    for (String host : new String[] {DOMAIN, "MXNSINN-SMP.NET", "mxnsinn-smp.net."}) {
      assertTrue(HostnameAdmissionPolicy.allows(DOMAIN, host, PUBLIC_PEER));
    }
  }

  @Test
  void rejectsMissingIpOtherDomainAndMalformedAddresses() {
    for (String host : new String[] {null, "", "86.97.163.169", "old.example.net", "mxnsinn-smp.net.attacker.net",
        "mxnsinn-smp.net..", "mxnsinn-smp.net\u0000anything", " mxnsinn-smp.net", "mxnsinn-smp.net:25565"}) {
      assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, host, PUBLIC_PEER), String.valueOf(host));
    }
  }

  @Test
  void localConnectionsMayUseLocalhostWithoutGrantingRemoteBypass() {
    for (String host : new String[] {"localhost", "LOCALHOST.", "127.0.0.1", "::1", "[::1]"}) {
      assertTrue(HostnameAdmissionPolicy.allows(DOMAIN, host, LOCAL_PEER));
      assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, host, PUBLIC_PEER));
      assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, host, null));
      assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, host,
          InetSocketAddress.createUnresolved("127.0.0.1", 48000)));
    }
    assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, "86.97.163.169", LOCAL_PEER));
    assertFalse(HostnameAdmissionPolicy.allows(DOMAIN, null, LOCAL_PEER));
  }
}
