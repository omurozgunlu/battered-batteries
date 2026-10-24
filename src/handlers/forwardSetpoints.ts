import type { InvocationContext } from "@azure/functions";
import type { MessageProcessor } from "../services/messageProcessor";

import type { SetPoint } from "../types/setpoint";
import { SetPointMessageSchema } from "../types/dto/setpointMessage";
import { toSetPoint } from "../mappers/toSetPoint";
import { ProcessResult } from "../services/types";

type Processor = Pick<MessageProcessor, "process">;

export function createForwardSetpoints(processor: Processor) {
  return async function forwardSetpoints(
    messages: unknown[],
    context: InvocationContext,
  ): Promise<void> {
    context.log(`Received a batch of ${messages.length} setpoints.`);

    const setpoints = parseSetpointMessages(messages, context);

    context.log("Setpoint validation completed.", {
      valid: setpoints.length,
      invalid: messages.length - setpoints.length,
    });

    if (setpoints.length === 0) {
      return;
    }

    const results = await processor.process(setpoints);
    handleResults(results, context);
  };
}

function handleResults(results: ProcessResult[], context: InvocationContext) {
  const failures = [];
  for (const result of results) {
    switch (result.status) {
      case "success":
        context.log(
          `Setpoint for device ${result.deviceId} processed successfully.`,
        );
        break;
      case "expired":
        context.warn(`Setpoint for device ${result.deviceId} has expired.`);
        break;
      case "rejected":
        context.error(`Setpoint for device ${result.deviceId} was rejected.`, {
          error: result.error,
        });
        break;
      case "failed":
        context.error(`Setpoint for device ${result.deviceId} failed.`, {
          error: result.error,
        });
        failures.push(result);
        break;
    }
  }
  if (failures.length > 0) {
    context.error(`There were ${failures.length} failed setpoints.`);
    throw new Error(
      `Failed to forward ${failures.length} setpoint(s): ${failures
        .map((failure) => failure.deviceId)
        .join(", ")}.`,
    );
  }
}

function parseSetpointMessages(
  messages: unknown[],
  context: InvocationContext,
): SetPoint[] {
  const setpoints: SetPoint[] = [];

  for (const [messageIndex, message] of messages.entries()) {
    const result = SetPointMessageSchema.safeParse(message);
    if (!result.success) {
      // Malformed messages are skipped; log validation details without the raw payload.
      context.warn("Skipping invalid setpoint message.", {
        messageIndex,
        issues: result.error.issues.map(({ code, path, message }) => ({
          code,
          path,
          message,
        })),
      });
      continue;
    }

    setpoints.push(toSetPoint(result.data));
  }

  return setpoints;
}
