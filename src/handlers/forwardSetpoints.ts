import type { InvocationContext } from "@azure/functions";
import type { MessageProcessor } from "../services/messageProcessor";

import type { SetPoint } from "../types/setpoint";
import { SetPointMessageSchema } from "../types/dto/setpointMessage";
import { toSetPoint } from "../mappers/toSetPoint";

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

    // Processing failures must propagate so an unsuccessful batch can be redelivered.
    await processor.process(setpoints, context);
  };
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
