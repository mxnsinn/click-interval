package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.velocitypowered.api.proxy.ConnectionRequestBuilder;
import org.junit.jupiter.api.Test;

final class RestoreConnectionPolicyTest {
  @Test
  void backendDisconnectRequiresPropagatingTheReasonAndUntracking() {
    assertEquals(
        RestoreConnectionPolicy.Action.DISCONNECT_BACKEND_REJECTION,
        RestoreConnectionPolicy.classify(ConnectionRequestBuilder.Status.SERVER_DISCONNECTED));
  }

  @Test
  void alreadyConnectedCompletesWithoutWaitingForAnEvent() {
    assertEquals(
        RestoreConnectionPolicy.Action.COMPLETE_ALREADY_CONNECTED,
        RestoreConnectionPolicy.classify(ConnectionRequestBuilder.Status.ALREADY_CONNECTED));
  }

  @Test
  void cancellationsRemainTrackedForTimeoutRecovery() {
    assertEquals(
        RestoreConnectionPolicy.Action.WAIT_FOR_TIMEOUT,
        RestoreConnectionPolicy.classify(ConnectionRequestBuilder.Status.CONNECTION_CANCELLED));
    assertEquals(
        RestoreConnectionPolicy.Action.WAIT_FOR_TIMEOUT,
        RestoreConnectionPolicy.classify(ConnectionRequestBuilder.Status.CONNECTION_IN_PROGRESS));
  }
}
