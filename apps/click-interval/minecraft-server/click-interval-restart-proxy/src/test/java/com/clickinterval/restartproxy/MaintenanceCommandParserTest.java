package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class MaintenanceCommandParserTest {
  @Test
  void parsesOnWithAnOptionalMessage() {
    MaintenanceCommandParser.Parsed parsed = MaintenanceCommandParser.parse(
        new String[] {"maintenance", "on", "Go", "get", "some", "sleep"});

    assertEquals(MaintenanceCommandParser.Operation.ON, parsed.operation());
    assertEquals("Go get some sleep", parsed.message());
  }

  @Test
  void parsesOnWhenMaintenanceIsTheRegisteredCommandAlias() {
    MaintenanceCommandParser.Parsed parsed = MaintenanceCommandParser.parse(
        new String[] {"on", "Updating", "now"});

    assertEquals(MaintenanceCommandParser.Operation.ON, parsed.operation());
    assertEquals("Updating now", parsed.message());
  }

  @Test
  void offAndReadyUseTheSafeRestorePath() {
    assertEquals(
        MaintenanceCommandParser.Operation.READY,
        MaintenanceCommandParser.parse(new String[] {"maintenance", "off"}).operation());
    assertEquals(
        MaintenanceCommandParser.Operation.READY,
        MaintenanceCommandParser.parse(new String[] {"ready"}).operation());
  }

  @Test
  void rejectsTrailingArgumentsForStatus() {
    assertEquals(
        MaintenanceCommandParser.Operation.INVALID,
        MaintenanceCommandParser.parse(new String[] {"status", "now"}).operation());
  }
}
