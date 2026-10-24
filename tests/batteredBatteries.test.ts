import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BatteredBatteriesClient } from '../src/clients/batteredBatteries/client';
import { toApiRequest } from '../src/mappers/toApi';
import { MessageProcessor } from '../src/services/messageProcessor';
import type { SetPoint } from '../src/types/setpoint';

type RecordedRequest = {
  config: InternalAxiosRequestConfig;
  at: number;
};

type MockResponse = {
  status: number;
  headers?: Record<string, string>;
};

const now = new Date('2026-10-22T10:00:00.000Z');

let requests: RecordedRequest[];
let responsesByUrl: Map<string, MockResponse[]>;
let client: BatteredBatteriesClient;
let processor: MessageProcessor;
let setpoint: SetPoint;

async function mockAdapter(config: InternalAxiosRequestConfig) {
  requests.push({ config, at: Date.now() });
  const { status, headers } = responsesByUrl.get(config.url ?? '')?.shift()
    ?? { status: 204 };
  const response = {
    status,
    statusText: String(status),
    data: undefined,
    headers: new AxiosHeaders(headers),
    config,
  };

  if (status !== 204) {
    throw new AxiosError('Mock HTTP failure', 'ERR_BAD_RESPONSE', config, undefined, response);
  }
  return response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  requests = [];
  responsesByUrl = new Map();
  const originalCreate = axios.create.bind(axios);
  vi.spyOn(axios, 'create').mockImplementation(config => originalCreate({
    ...config,
    adapter: mockAdapter,
  }));

  client = new BatteredBatteriesClient({
    apiKey: 'test-key',
    baseURL: 'https://batteries.test',
  });
  processor = new MessageProcessor(client);
  setpoint = {
    deviceId: 'BB00001',
    value: 1,
    unit: 'kW',
    endTime: now.getTime() + 60_123,
    eventTime: now.getTime() - 10_000,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('skips commands without a valid interval and independently retries valid commands without extending expiry', async () => {
  responsesByUrl.set('/BB00001/setpoint', [
    { status: 429, headers: { 'retry-after': '2' } },
    { status: 500 },
    { status: 204 },
  ]);
  const endTime = now.getTime() / 1_000 + 60;

  for (const remainingMs of [400, 1_000, 1_999]) {
    await expect(processor.process([{
      ...setpoint,
      endTime: now.getTime() + remainingMs,
    }])).resolves.toEqual([{ deviceId: 'BB00001', status: 'expired' }]);
  }
  expect(requests).toHaveLength(0);
  expect(toApiRequest({ ...setpoint, endTime: now.getTime() + 2_000 }).data)
    .toMatchObject({
      startTime: now.getTime() / 1_000 + 1,
      endTime: now.getTime() / 1_000 + 2,
    });

  const request = toApiRequest(setpoint);
  expect(request).toEqual({
    deviceId: 'BB00001',
    data: { startTime: now.getTime() / 1_000 + 1, endTime, value: -1_000 },
  });
  await expect(client.sendSetpoint({
    ...request,
    data: { ...request.data, endTime: request.data.startTime },
  }))
    .rejects.toBeInstanceOf(TypeError);
  expect(requests).toHaveLength(0);

  const result = expect(client.sendSetpoint(request))
    .resolves.toBeUndefined();
  const independentResult = expect(client.sendSetpoint({ ...request, deviceId: 'BB00005' }))
    .resolves.toBeUndefined();

  await vi.advanceTimersByTimeAsync(0);
  await independentResult;
  expect(requests).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(requests).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(2_199);
  expect(requests).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1);
  await result;

  expect(requests.map(request => request.at - now.getTime())).toEqual([0, 0, 2_000, 4_200]);
  expect(requests).toHaveLength(4);
  expect(requests.map(({ config }) => config.url)).toEqual([
    '/BB00001/setpoint',
    '/BB00005/setpoint',
    '/BB00001/setpoint',
    '/BB00001/setpoint',
  ]);
  for (const { config, at } of requests) {
    expect(config.baseURL).toBe('https://batteries.test');
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
  expect(request.data.startTime).toBe(now.getTime() / 1_000 + 1);
});

// TODO: Test that HTTP 400/422 throw SetpointRejectedError after one attempt and the processor reports rejected.
// TODO: Test that HTTP 401/404 throw BatteredBatteriesApiError after one attempt and the processor reports failed.
// TODO: Test that exhausted HTTP/network retries and retry budgets throw BatteredBatteriesApiError while expiry throws SetpointExpiredError.
// TODO: Test that the processor classifies SetpointRejectedError by type regardless of its optional HTTP status metadata.
// TODO: Test that unexpected errors remain failed results rather than rejected or expired commands.
// TODO: Test that persistent 429/500 responses stop after four attempts and expose status and attempts.
// TODO: Test that a Retry-After HTTP date delays the next attempt until that date.
// TODO: Test that invalid Retry-After values fall back to exponential backoff with jitter.
// TODO: Test that a long Retry-After is interrupted by the command deadline without sending another request.
// TODO: Test that timeouts, connection resets, and temporary DNS failures retry within the time budget.
// TODO: Test that an expired setpoint makes no request, including when it expires during backoff.
// TODO: Test that command cancellation stops a request when the overall deadline precedes its HTTP timeout.
// TODO: Test that concurrent requests remain independent when one fails or exhausts its retry budget.
// TODO: Test that Retry-After delays only the affected command, including concurrent calls for the same device.
// TODO: Test that endTime before startTime fails before sending HTTP requests.
// TODO: Test that error serialization contains no API key, Axios config, or raw response body.
// TODO: Test that an HTTP timeout retries with the same command deadline signal and respects backoff.
// TODO: Test that a stale startTime is refreshed while the original request and endTime remain unchanged.
// TODO: Test that refreshSetpoint preserves future starts and rejects an endTime at or before the next valid second.
// TODO: Test that toApiRequest rounds fractional watts and uses current time even when eventTime is old.
// TODO: Test that SetPointMessageSchema rejects empty device IDs, non-kW units, and malformed ISO dates.
// TODO: Test that createForwardSetpoints passes valid messages in order when malformed entries occur between them.
// TODO: Test that createForwardSetpoints logs each invalid entry's index and validation issues without its raw payload.
// TODO: Test that createForwardSetpoints skips the processor for an empty batch or a batch with no valid messages.
// TODO: Test that createForwardSetpoints propagates processor failures so the invocation fails rather than acknowledging unfinished work.
// TODO: Test that createForwardSetpoints rejects after logging all results when one delivery fails alongside successful and expired commands.
// TODO: Test that createForwardSetpoints resolves when results contain only successful and expired commands.
// TODO: Test that createForwardSetpoints transforms valid DTOs into flat SetPoint values with millisecond timestamps and passes the invocation context.
// TODO: Test that SetPointMessageSchema still returns the original nested DTO with ISO date strings when parsed directly.
