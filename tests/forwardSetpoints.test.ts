import { InvocationContext } from '@azure/functions';
import { beforeEach, expect, it, vi } from 'vitest';
import { createForwardSetpoints } from '../src/handlers/forwardSetpoints';
import type { MessageProcessor } from '../src/services/messageProcessor';
import type { SetPointMessage } from '../src/types/dto/setpointMessage';

const processor = { process: vi.fn<MessageProcessor['process']>() };
const log = vi.fn();
let context: InvocationContext;

beforeEach(() => {
  processor.process.mockReset().mockResolvedValue([]);
  log.mockReset();
  context = new InvocationContext({ logHandler: log });
});

it('skips malformed messages and passes mapped setpoints to the processor in order', async () => {
  const first: SetPointMessage = {
    device_id: 'BB00001',
    setpoint: { value: 1, unit: 'kW', endTime: '2026-10-22T10:01:00.000Z' },
    eventTime: '2026-10-22T10:00:00.000Z',
  };
  const second: SetPointMessage = { ...first, device_id: 'BB00005' };
  const malformed = {
    ...first,
    setpoint: { ...first.setpoint, unit: 'W' },
    privateData: 'do-not-log-this-payload',
  };
  processor.process.mockResolvedValue([
    { deviceId: 'BB00001', status: 'success' },
    { deviceId: 'BB00005', status: 'success' },
  ]);
  const handler = createForwardSetpoints(processor);

  await expect(handler([first, malformed, second], context)).resolves.toBeUndefined();

  expect(processor.process).toHaveBeenCalledExactlyOnceWith([
    {
      deviceId: 'BB00001',
      value: 1,
      unit: 'kW',
      endTime: Date.parse('2026-10-22T10:01:00.000Z'),
      eventTime: Date.parse('2026-10-22T10:00:00.000Z'),
    },
    {
      deviceId: 'BB00005',
      value: 1,
      unit: 'kW',
      endTime: Date.parse('2026-10-22T10:01:00.000Z'),
      eventTime: Date.parse('2026-10-22T10:00:00.000Z'),
    },
  ]);
  expect(log).toHaveBeenCalledWith('warning', 'Skipping invalid setpoint message.', {
    messageIndex: 1,
    issues: expect.arrayContaining([
      expect.objectContaining({
        code: expect.any(String),
        path: ['setpoint', 'unit'],
        message: expect.any(String),
      }),
    ]),
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(malformed.privateData);
});

// TODO: Test that empty or fully invalid batches do not call the processor.
// TODO: Test that the handler propagates processor errors and logs all results before throwing for failed deliveries.
// TODO: Test that successful, expired, and rejected results complete without throwing.
// TODO: Test that the processor skips unknown devices and expired commands, keeping the newest event per device.
// TODO: Test that the processor maps known error types to rejected/expired results and unexpected errors to failed.
// TODO: Test that HTTP 400/422 are rejected, while HTTP 401/404 fail without retries.
// TODO: Test that the input schema rejects empty device IDs, invalid units, and malformed dates.
// TODO: Test that toApiRequest converts milliseconds and kW to seconds and watts, inverts the sign, and uses a future start.
// TODO: Test that invalid integers or endTime <= startTime fail before sending HTTP.
// TODO: Test that retries refresh stale starts without changing expiry or the original request, and skip commands with no valid interval.
// TODO: Test that the client sends the expected POST body and headers, uses a five-second timeout, and accepts only HTTP 204.
// TODO: Test that 429/500 and network failures retry with backoff, stopping after four attempts.
// TODO: Test that Retry-After supports seconds and dates, with invalid values falling back to jittered backoff.
// TODO: Test that expiry or the 30-second budget stops requests and retry waits without sending another attempt.
// TODO: Test that one command's retry delays or failures do not block other commands.
// TODO: Test that API errors retain status and attempt counts without exposing credentials, Axios config, or response bodies.
