import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { BatteredBatteriesClient } from '../src/clients/batteredBatteries/client';
import { toApiRequest } from '../src/mappers/toApi';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('validates commands, honors Retry-After, and retries a 500 while preserving expiry', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-10-22T10:00:00.000Z');
  vi.setSystemTime(now);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  const requests: { config: InternalAxiosRequestConfig; at: number }[] = [];
  const originalCreate = axios.create.bind(axios);
  vi.spyOn(axios, 'create').mockImplementation(config => originalCreate({
    ...config,
    adapter: async request => {
      requests.push({ config: request, at: Date.now() });
      const status = [429, 500, 204][requests.length - 1] ?? 204;
      const response = {
        status,
        statusText: String(status),
        data: undefined,
        headers: new AxiosHeaders(status === 429 ? { 'retry-after': '2' } : {}),
        config: request,
      };
      if (status !== 204) {
        throw new AxiosError('Mock HTTP failure', 'ERR_BAD_RESPONSE', request, undefined, response);
      }
      return response;
    },
  }));

  const client = new BatteredBatteriesClient({
    apiKey: 'test-key',
    baseURL: 'https://batteries.test',
  });
  const endTime = now.getTime() / 1_000 + 60;
  const request = toApiRequest({
    deviceId: 'BB00001',
    value: 1,
    unit: 'kW',
    endTime: now.getTime() + 60_123,
    eventTime: now.getTime() - 10_000,
  }, 1_000);
  expect(request).toEqual({
    deviceId: 'BB00001',
    data: { startTime: now.getTime() / 1_000 + 2, endTime, value: -1_000 },
  });
  await expect(client.sendSetpoint({ ...request, data: { ...request.data, value: -1_000.5 } }))
    .rejects.toBeInstanceOf(TypeError);
  expect(requests).toHaveLength(0);

  const result = expect(client.sendSetpoint(request))
    .resolves.toBeUndefined();

  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1_499);
  expect(requests).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  await result;

  expect(requests.map(request => request.at - now.getTime())).toEqual([0, 2_000, 3_500]);
  expect(requests).toHaveLength(3);
  for (const { config, at } of requests) {
    expect(config.baseURL).toBe('https://batteries.test');
    expect(config.url).toBe('/BB00001/setpoint');
    expect(config.method).toBe('post');
    expect(config.headers.get('Ocp-Apim-Subscription-Key')).toBe('test-key');
    expect(config.headers.get('Content-Type')).toBe('application/json');
    expect(config.timeout).toBe(5_000);
    expect(config.validateStatus?.(204)).toBe(true);
    expect(config.validateStatus?.(200)).toBe(false);
    expect(JSON.parse(config.data as string)).toEqual({
      data: {
        startTime: Math.max(request.data.startTime, Math.floor(at / 1_000) + 1),
        endTime,
        value: -1_000,
      },
    });
  }
  expect(request.data.startTime).toBe(now.getTime() / 1_000 + 2);
});

// TODO: Test that 400, 401, and 404 responses fail after one request without retrying.
// TODO: Test that persistent 429/500 responses stop after four attempts and expose status and attempts.
// TODO: Test that a Retry-After HTTP date delays the next attempt until that date.
// TODO: Test that invalid Retry-After values fall back to exponential backoff with jitter.
// TODO: Test that a Retry-After exceeding the 30-second budget fails without shortening the server delay.
// TODO: Test that timeouts, connection resets, and temporary DNS failures retry within the time budget.
// TODO: Test that an expired setpoint makes no request, including when it expires during backoff.
// TODO: Test that request timeout shrinks to the remaining setpoint lifetime or retry budget.
// TODO: Test that concurrent calls are serialized and a rejected call does not block the next call.
// TODO: Test that a final 429 preserves the shared cooldown for the next queued command.
// TODO: Test that noninteger watts/timestamps fail before sending HTTP requests.
// TODO: Test that error serialization contains no API key, Axios config, or raw response body.
// TODO: Test that the client rejects NaN/infinite watts, fractional Unix timestamps, and endTime at or before startTime.
// TODO: Test that a stale startTime is refreshed while the original request and endTime remain unchanged.
// TODO: Test that toApiRequest rounds fractional watts and uses current time even when eventTime is old.
// TODO: Test that SetPointMessageSchema rejects empty device IDs, non-kW units, and malformed ISO dates.
// TODO: Test that createForwardSetpoints passes valid messages in order when malformed entries occur between them.
// TODO: Test that createForwardSetpoints logs each invalid entry's index and validation issues without its raw payload.
// TODO: Test that createForwardSetpoints skips the processor for an empty batch or a batch with no valid messages.
// TODO: Test that createForwardSetpoints propagates processor failures so the invocation fails rather than acknowledging unfinished work.
// TODO: Test that createForwardSetpoints transforms valid DTOs into flat SetPoint values with millisecond timestamps and passes the invocation context.
// TODO: Test that SetPointMessageSchema still returns the original nested DTO with ISO date strings when parsed directly.
