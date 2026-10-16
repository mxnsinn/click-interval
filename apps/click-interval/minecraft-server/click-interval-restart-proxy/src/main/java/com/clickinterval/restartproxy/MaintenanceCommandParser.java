package com.clickinterval.restartproxy;

import java.util.Arrays;
import java.util.Locale;

final class MaintenanceCommandParser {
  enum Operation {
    ON,
    READY,
    STATUS,
    HELP,
    INVALID
  }

  record Parsed(Operation operation, String message) {}

  private MaintenanceCommandParser() {}

  static Parsed parse(String[] arguments) {
    if (arguments == null || arguments.length == 0) {
      return new Parsed(Operation.HELP, "");
    }

    String first = arguments[0].toLowerCase(Locale.ROOT);
    if ("status".equals(first)) {
      return arguments.length == 1
          ? new Parsed(Operation.STATUS, "")
          : new Parsed(Operation.INVALID, "");
    }
    if ("ready".equals(first) || "off".equals(first)) {
      return arguments.length == 1
          ? new Parsed(Operation.READY, "")
          : new Parsed(Operation.INVALID, "");
    }
    if ("on".equals(first)) {
      return new Parsed(
          Operation.ON,
          arguments.length > 1
              ? String.join(" ", Arrays.copyOfRange(arguments, 1, arguments.length)).trim()
              : "");
    }
    if (!"maintenance".equals(first)) {
      return new Parsed(Operation.INVALID, "");
    }
    if (arguments.length == 1) {
      return new Parsed(Operation.STATUS, "");
    }

    String action = arguments[1].toLowerCase(Locale.ROOT);
    return switch (action) {
      case "status" -> arguments.length == 2
          ? new Parsed(Operation.STATUS, "")
          : new Parsed(Operation.INVALID, "");
      case "off", "ready" -> arguments.length == 2
          ? new Parsed(Operation.READY, "")
          : new Parsed(Operation.INVALID, "");
      case "on" -> new Parsed(
          Operation.ON,
          arguments.length > 2
              ? String.join(" ", Arrays.copyOfRange(arguments, 2, arguments.length)).trim()
              : "");
      default -> new Parsed(Operation.INVALID, "");
    };
  }
}
