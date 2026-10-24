# Battered Batteries

A TypeScript Azure Functions v4 application that consumes batches from the Service
Bus queue `sbq-batbat-spt`, validates and selects battery setpoints, then forwards
them to the Battered Batteries API using Axios.

## Setup

Use Node.js 24 (`nvm use` if you use nvm):

```bash
npm ci
cp local.settings.example.json local.settings.json
```

Azure Functions Core Tools and Azurite are project-local development dependencies.
The npm scripts find their executables automatically. Installing Core Tools and
starting the Functions host for the first time may require downloads.

### Configuration

Fill in the `Values` object in `local.settings.json`:

| Setting | Purpose |
| --- | --- |
| `AzureWebJobsStorage` | Host storage; `UseDevelopmentStorage=true` uses local Azurite. |
| `FUNCTIONS_WORKER_RUNTIME` | Set to `node`. |
| `AzureWebJobs.forwardSetpoints.Disabled` | Defaults to `"true"` in the example. Set to `"false"` when ready to consume messages. |
| `CONNECTION-STRING-SBQ-BATBAT-SPT` | Connection string for the Service Bus namespace containing the queue. |
| `BATTERED_BATTERIES_API_URL` | API base URL; the supplied specification uses `https://BatB.azure-api.net`. |
| `BATTERED_BATTERIES_API_KEY` | API subscription key supplied with the assignment. |

The Functions host supplies these values as environment variables; the application
does not load `.env`. `loadConfig()` requires nonempty API URL and key values at
module initialization, including when the queue trigger is disabled. The Service
Bus connection is resolved by the trigger binding from the named setting.

The API key and Service Bus connection string are separate credentials. The
assignment supplies an API key; obtain the Service Bus connection string separately.
Azurite emulates Azure Storage for the host, not Service Bus. Local settings are
ignored by Git. In Azure, configure the corresponding application settings.

### Run locally

Start storage in one terminal:

```bash
npm run storage
```

Start the Functions host in another terminal:

```bash
npm start
```

`npm start` builds TypeScript before launching the host. To consume messages, the
queue must exist, its connection setting must be populated, and the function must
be enabled. Restart the host after changing source code or settings.

This is a Service Bus trigger; it exposes no HTTP endpoint. Publish messages to
`sbq-batbat-spt` to exercise the running function. Enabled local execution forwards
selected commands to the configured API. Use `npm test` for mocked execution that
requires neither Azure credentials nor a running host.

## Processing flow

1. `src/functions/forwardSetpoints.ts` loads configuration, constructs a reusable
   client and processor, and registers the batched Service Bus trigger.
2. The handler validates each array element with `SetPointMessageSchema.safeParse`.
   Invalid entries are logged with their index and validation issues, then skipped.
   The raw message is not logged. Valid DTOs are mapped to internal `SetPoint` values.
3. The processor filters the device allowlist, keeps the greatest `eventTime` for
   each device within the batch, then removes commands whose `endTime` has passed.
   Equal event times keep the first occurrence. Selecting before filtering expiry
   prevents falling back to an older command when the newest one has expired.
4. Each selected command is mapped to an API request and sent concurrently.
   `Promise.allSettled` allows every selected command to finish before results
   are classified.
5. The handler logs the results and throws if any command has status `failed`.
   Empty batches and batches without valid messages return without calling the
   processor.

Allowed devices are `BB00001`, `BB00005`, `BB00006`, `BB00007`, and `BB00293`.
Messages for other devices are skipped. This interprets the assignment's
“abandon” as ignoring unsupported devices; it does not invoke the Service Bus
Abandon operation for individual messages.

## Message and API mapping

Incoming messages contain `device_id`, a nested `setpoint` with `value`, `unit`,
and ISO `endTime`, plus ISO `eventTime`. Validation requires a nonempty device ID,
numeric power, unit `kW`, and valid ISO timestamps. `toSetPoint` converts the
validated DTO into a flat object with Unix millisecond timestamps.

The outgoing request is `POST /{deviceId}/setpoint`, authenticated with the
`Ocp-Apim-Subscription-Key` header. Only `{ data }` is sent in the body:

```json
{
  "data": {
    "startTime": 1735725601,
    "endTime": 1735725660,
    "value": -1000
  }
}
```

These timestamps illustrate the format; real requests use the current time.

| API field | Mapping |
| --- | --- |
| URL device ID | Internal `deviceId`, encoded as a path segment. |
| `startTime` | `Math.floor(Date.now() / 1000) + 1`. |
| `endTime` | Incoming end time, floored to Unix seconds. |
| `value` | `Math.round(-incomingValue * 1000)`, in integer watts. |

Incoming positive power means discharge, so `1 kW` becomes `-1000 W`. Incoming
negative power means charge. The next whole-second start reconciles the assignment's
immediate activation requirement with the API's requirement for a future timestamp;
it introduces up to one second of scheduling delay at mapping time.

If rounding leaves `endTime <= startTime`, the mapper throws `SetpointExpiredError`
without sending HTTP. Before every HTTP attempt, the client refreshes a stale start
time while preserving the original end time and power. Requests with no remaining
valid interval expire. Direct client inputs must contain safe integers and an end
time after the supplied start time; invalid inputs throw `TypeError`.

## Retries and failure policy

The client accepts only HTTP 204 as success. `axios-retry` handles retries with
limits from `src/clients/batteredBatteries/constants.ts`:

| Policy | Value |
| --- | --- |
| Total attempts | At most 4: the initial attempt plus 3 retries. |
| HTTP timeout | 5 seconds per attempt. |
| Command time budget | 30 seconds, shortened to the command's end time. |
| Backoff | Exponential delay with jitter, starting around 1 second and capped at 5 seconds. |
| `Retry-After` | Honored when longer than the calculated backoff. |

HTTP 408, 429, 500, 502, 503, and 504 and selected network/timeout errors are
retryable. Other HTTP responses are not retried by the client. One cancellation
signal covers attempts and retry waits. A long `Retry-After` can exhaust the
command's time budget; the client stops rather than retrying early.

HTTP status classification belongs to the client. The processor checks error types:

| Outcome | Classification | Handler behavior |
| --- | --- | --- |
| `success` | HTTP 204. | Log success. |
| `expired` | `SetpointExpiredError`, including expiry after timestamp rounding or during retries. | Log and skip. |
| `rejected` | `SetpointRejectedError` for HTTP 400/422. | Log and skip. |
| `failed` | Other `BatteredBatteriesApiError` failures or unexpected errors. | Log and fail the invocation after processing all results. |

`SetpointRejectedError` extends `BatteredBatteriesApiError`. The base error exposes
attempts, optional HTTP status, and transport code without retaining raw Axios
config, response bodies, or the API key. HTTP 401/404 remain failures under the
current policy, despite not being retried within a client call. Commands already
expired at the processor's initial filter are removed without producing a result.

With automatic Service Bus settlement, a successful invocation completes the batch,
including skipped malformed, unsupported, and rejected messages. These entries are
not individually dead-lettered. A failed invocation permits batch redelivery, so
commands that already succeeded may be sent again.

## Reliability limits

- **Ordering:** latest-per-device selection applies only within a batch. Independent
  invocations and retries can send an older command after a newer one. No durable
  last-processed timestamp or per-device coordination is implemented. A production
  design could use Service Bus sessions set by the producer and durable event-time
  tracking. The vendor API has no conditional version check; a timed-out request
  may still be processed remotely.
- **Load:** selected commands run concurrently. Backoff and `Retry-After` apply only
  to the affected command; there is no shared cooldown or outbound rate limiter.
  Deployment scale limits are not configured in this repository. Per-device sessions
  alone would not limit total vendor traffic. The specification provides no numeric
  quota; deployment concurrency and any shared limiter need an agreed capacity.
- **Delivery:** batch redelivery can repeat successful commands. POST retries assume
  the documented replacement behavior, but the API provides no idempotency key.
- **Message locks:** queue lock settings must accommodate the processing budget and
  overhead. For batches, the binding's `maxAutoLockRenewalDuration` setting does not
  apply; review the queue lock duration before deployment.
  See the [Service Bus binding settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus#hostjson-settings).

The supplied one-second replacement demonstration is not implemented as an automatic
clear operation; commands preserve their original expiry.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/functions/forwardSetpoints.ts` | Function registration and dependency construction. |
| `src/handlers/forwardSetpoints.ts` | Per-message validation, DTO mapping, logging, and invocation failure policy. |
| `src/services/messageProcessor.ts` | Device filtering, batch deduplication, expiry filtering, delivery, and result classification. |
| `src/services/types.ts` | `ProcessResult` discriminated union. |
| `src/types/dto/setpointMessage.ts` | Zod input schema and inferred DTO type. |
| `src/types/setpoint.ts` | Internal setpoint type using milliseconds and kW. |
| `src/mappers/` | DTO-to-domain and domain-to-API conversions. |
| `src/constants/allowedDevices.ts` | Device allowlist. |
| `src/clients/batteredBatteries/` | Axios client, plain API types, retry policy, errors, and timing helpers. |
| `src/config.ts` | API environment validation. |
| `host.json` | Host schema version `2.0` and extension bundle providing Service Bus bindings. |
| `tests/` | One implemented Vitest test and descriptive TODO comments. |

The v4 programming model registers the function in code, so no `function.json` is
needed. `package.json` loads compiled `dist/functions/*.js`; `tsconfig.json` enables
strict type checking and compiles `src/` into `dist/`.

## Checks

```bash
npm run typecheck
npm run build
npm test
```

The single implemented test in `tests/forwardSetpoints.test.ts` exercises the
handler with a mocked processor and a real `InvocationContext`. It verifies that
malformed messages are skipped, valid DTOs are mapped and passed to the processor
in order, and validation warnings include the entry index and issues without the
raw payload. It requires no Azure host, network, or timer mocks. API client,
processor, and other handler scenarios remain descriptive TODO comments as requested
by the assignment. See [tests/README.md](tests/README.md).

## References

- [Azure Functions Node.js programming model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Service Bus trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger)
- [Service Bus binding settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus#hostjson-settings)
- [Azure Functions concurrency](https://learn.microsoft.com/en-us/azure/azure-functions/functions-concurrency)
- [axios-retry](https://github.com/softonic/axios-retry)
