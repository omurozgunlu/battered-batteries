# Battered Batteries

Azure Functions v4 programming model project in TypeScript. The battery API client
is implemented and has one mocked Vitest test. Queue processing is still a placeholder.

## Setup

Use Node.js 24 (`nvm use` if you have nvm), then:

```bash
npm ci
cp local.settings.example.json local.settings.json
npm run build
```

Azure Functions Core Tools (`func`) and Azurite are project-local development
dependencies. npm scripts find their executables automatically; no global install
is needed. The first install downloads the Core Tools runtime binary.

## Local configuration

The Functions host reads settings from the `Values` object in `local.settings.json`
and supplies them as environment variables. This project does not load `.env`.
`local.settings.json` is ignored by Git.

| Setting | Purpose |
| --- | --- |
| `AzureWebJobsStorage` | Host storage; the example uses local Azurite. |
| `FUNCTIONS_WORKER_RUNTIME` | Selects the Node.js worker. |
| `AzureWebJobs.forwardSetpoints.Disabled` | Keeps the unfinished queue trigger disabled locally. |
| `CONNECTION-STRING-SBQ-BATBAT-SPT` | Service Bus connection string supplied separately from the API key. |
| `BATTERED_BATTERIES_API_URL` | Base URL for the HTTP client. |
| `BATTERED_BATTERIES_API_KEY` | Copy the API key from the assignment here. |

The assignment supplies an API key, but no Service Bus connection string. The API
key cannot authenticate to Service Bus. Azurite emulates Azure Storage for the host;
it does not emulate Service Bus.

## Run locally

Start storage in one terminal:

```bash
npm run storage
```

Start the Functions host in another terminal:

```bash
npm start
```

`npm start` builds TypeScript before launching the host. The host may download its
extension bundle on the first run, which requires internet access. No queue messages
are consumed while the function is disabled.

Once forwarding is implemented and you have a Service Bus connection string, fill
in the connection setting and change `AzureWebJobs.forwardSetpoints.Disabled` to
`"false"`. The configured queue must exist. Restart the host after changing settings
or source code. The processor currently filters and maps commands but does not send them yet.

## Files

- `src/functions/forwardSetpoints.ts`: registers a batched Service Bus trigger
  using `app.serviceBusQueue` and constructs the shared processor and API client.
- `src/handlers/forwardSetpoints.ts`: validates and transforms individual messages,
  then passes internal `SetPoint` values and invocation context to the injected processor.
- `package.json`: `main` tells the worker to load compiled `dist/functions/*.js`.
- `tsconfig.json`: compiles `src/` into `dist/` with strict type checking.
- `host.json`: host settings and the extension bundle that supplies Service Bus bindings.
  Its `version: "2.0"` is the host configuration schema, not the programming model version.
- `local.settings.example.json`: copyable local configuration without credentials.
- `src/clients/batteredBatteries/client.ts`: HTTP requests, `axios-retry` setup,
  and setpoint timing/expiry handling.
- `src/clients/batteredBatteries/refreshSetpoint.ts`: pure start-time refresh and
  expiry check using an explicitly supplied current time.
- `src/clients/batteredBatteries/constants.ts`: retry limits and retryable HTTP/network errors.
- `src/clients/batteredBatteries/errors.ts`: API failure and setpoint expiry error classes.
- `src/clients/batteredBatteries/types.ts`: plain `ApiRequest` type, with a path device ID
  and HTTP request data in seconds and watts.
- `src/types/dto/setpointMessage.ts`: incoming `SetPointMessageSchema` and its inferred
  `SetPointMessage` type, preserving the nested message shape and ISO date strings.
- `src/mappers/toSetPoint.ts`: pure conversion from a validated DTO to a flat `SetPoint`.
- `src/mappers/toApi.ts`: converts internal milliseconds/kW into API seconds/watts
  with a future start based on current time and the configured lead time.
- `src/types/setpoint.ts`: internal representation, with timestamps in Unix milliseconds
  and power in kW using the incoming grid sign convention.
- `tests/`: the assignment's single Vitest test and remaining test TODO comments.

No `function.json` is needed: the v4 programming model registers the trigger in code.
The handler is wired to `MessageProcessor`. Its remaining forwarding step is to call
`apiClient.sendSetpoint(request)` for each prepared API request.

## Incoming message failure policy

The handler composes `SetPointMessageSchema.transform(toSetPoint)` and calls `safeParse`
on each element. Valid DTOs become flat `SetPoint` values; ISO dates become numeric
Unix millisecond timestamps. The raw DTO schema remains available independently. Malformed
entries are logged and skipped; warnings include the entry index and validation
issues, without the raw payload. Valid messages retain their original order and are
passed to `processMessages` together. Empty batches and batches without valid entries
return successfully without calling the processor.

Processor failures propagate to fail the invocation. With automatic Service Bus
settlement, successful invocations complete their messages, including intentionally
skipped malformed entries; failed invocations can cause batch redelivery. This policy
does not individually dead-letter malformed messages. Previously processed entries
may be delivered again after a failed batch.

## Battery API client

Create one client per worker and reuse it across batches:

```typescript
import { BatteredBatteriesClient } from './clients/batteredBatteries/client';
import { loadConfig } from './config';

const config = loadConfig();
const client = new BatteredBatteriesClient({
  apiKey: config.BATTERED_BATTERIES_API_KEY,
  baseURL: config.BATTERED_BATTERIES_API_URL,
});

const now = Math.floor(Date.now() / 1_000);
await client.sendSetpoint({
  deviceId: 'BB00001',
  data: {
    startTime: now + 1,
    endTime: now + 60,
    value: -1_000, // Integer watts in API convention: negative discharges.
  },
});
```

The handler owns input validation. The processor owns the device allowlist, kW-to-W
conversion with sign inversion, and ordering by eventTime. `toApiRequest` performs the
unit conversion: it rounds power to integer watts, floors the end time to Unix seconds,
and chooses a future whole-second start after current time plus the supplied millisecond
offset. The client takes this complete `ApiRequest`, uses `deviceId` in the URL, and
sends only `{ data }` as JSON. If retries make startTime stale, the client
refreshes it to the next whole second while preserving the original endTime and value.
A command with no remaining valid start time throws `SetpointExpiredError`.

`axios-retry` controls retries: 3 retries after the initial request, giving 4 total
attempts. Limits remain in `RETRY_POLICY` in `constants.ts`: a 5-second timeout per
attempt, a 30-second total budget, and exponential backoff capped
at 5 seconds. The plugin provides exponential delay with jitter and `Retry-After`
parsing. The client caps the backoff and honors a longer `Retry-After` separately.
One cancellation signal bounds the whole command, including HTTP attempts and
retry delays. It expires after 30 seconds or at the setpoint end
time, whichever comes first. A long `Retry-After` is interrupted at that deadline;
the client does not retry early. Constructor options remain API key and base URL;
`loadConfig` handles configuration separately.

A normal Axios request interceptor refreshes the start time and rejects expired
setpoints before each attempt through the pure `refreshSetpoint` helper. The
interceptor handles both the initial object body and the serialized JSON reused
by `axios-retry`. Axios applies its 5-second HTTP timeout per attempt;
the command's cancellation signal provides the overall deadline. There are no
per-attempt transformers or signal-reset hooks.

Only HTTP 204 is success; no response body is required. The client retries HTTP 408,
429, 500, 502, 503, and 504 plus selected network/timeout errors. Other failures,
including 400/401/404, fail immediately. `BatteredBatteriesApiError` exposes attempts,
HTTP status, and transport code without retaining Axios config or the API key.
The outgoing request uses a plain TypeScript type. The client rejects endTime at or
before startTime with `TypeError`; incoming queue messages continue to use Zod
validation. The timing helper returns a new request so retries do not mutate the
caller's object. Timing and expiry are checked for every attempt.

Calls run independently, including calls for the same device. Retry backoff and
`Retry-After` apply only to the affected command; the client has no queue, shared
cooldown, or concurrency limit. The caller controls concurrency, while the
processor/host must manage scale and duplicate or out-of-order deliveries.
Avoid adding an independent retry loop around the client without accounting for
Service Bus redelivery and message lock duration.

Retrying a POST assumes the documented replacement behavior: resending the desired
value with its original end time replaces the same battery command. A timeout leaves
delivery uncertain; overlapping commands and retries can arrive out of order at
the vendor, within one worker or across workers. The API supplies no idempotency key or version
field. Automatic one-second clearing is not part of this client.

## Checks

```bash
npm run typecheck
npm run build
npm test
```

Vitest discovers `*.test.ts` files without additional configuration. The one mapper/client
test uses fake time and a mocked Axios adapter; remaining scenarios are TODO comments.

## References

- [Azure Functions Node.js programming model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Service Bus trigger and batching](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger)
- [Azure Functions Core Tools](https://github.com/Azure/azure-functions-core-tools)
- [Azurite storage emulator](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite)
- [Vitest](https://vitest.dev/guide/)
- [Axios request configuration](https://axios-http.com/docs/req_config)
- [axios-retry configuration and Retry-After support](https://github.com/softonic/axios-retry)
- [Transient fault handling and retry guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults)
