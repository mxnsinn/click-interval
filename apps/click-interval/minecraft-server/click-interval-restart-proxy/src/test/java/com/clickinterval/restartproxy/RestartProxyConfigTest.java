package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Properties;
import org.junit.jupiter.api.Test;

final class RestartProxyConfigTest {
  @Test
  void parsesACompleteConfiguration() {
    Properties properties = defaults();
    RestartProxyConfig config = RestartProxyConfig.fromProperties(properties);

    assertEquals("main", config.mainServer());
    assertEquals("maintenance", config.maintenanceServer());
    assertEquals(15, config.drainTimeoutSeconds());
    assertEquals(20, config.restoreTimeoutSeconds());
    assertEquals("", config.requiredHostname());
  }

  @Test
  void parsesOptionalRequiredHostnameWithoutBreakingExistingConfigurations() {
    Properties properties = defaults();
    properties.setProperty("required-hostname", " MXNSINN-SMP.NET. ");
    assertEquals("mxnsinn-smp.net", RestartProxyConfig.fromProperties(properties).requiredHostname());
    for (String invalid : new String[] {"https://mxnsinn-smp.net", "mxnsinn-smp.net:25565",
        "mxnsinn-smp.net\nother", ".mxnsinn-smp.net", "mxnsinn-smp..net", "-invalid.net"}) {
      properties.setProperty("required-hostname", invalid);
      assertThrows(IllegalArgumentException.class, () -> RestartProxyConfig.fromProperties(properties));
    }
  }

  @Test
  void rejectsUnsafeTimeouts() {
    Properties properties = defaults();
    properties.setProperty("restore-timeout-seconds", "2");

    assertThrows(IllegalArgumentException.class, () -> RestartProxyConfig.fromProperties(properties));
  }

  private static Properties defaults() {
    Properties properties = new Properties();
    properties.setProperty("main-server", "main");
    properties.setProperty("maintenance-server", "maintenance");
    properties.setProperty("default-message", "Updating");
    properties.setProperty("drain-timeout-seconds", "15");
    properties.setProperty("restore-timeout-seconds", "20");
    return properties;
  }
}
