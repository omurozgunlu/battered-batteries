# Tests

Run `npm test`. The single implemented test in `batteredBatteries.test.ts` exercises
the API client's 429 Retry-After and 500 backoff path using the real `axios-retry`
plugin and a mocked Axios adapter. A second command succeeds immediately while the
first command waits for its retries.
Before sending valid commands, the same test checks that the processor classifies
commands with no valid whole-second interval as expired without making HTTP requests,
and that the earliest representable interval remains valid.
It also checks the outgoing request and that retries preserve expiry while refreshing
the future start time without mutating the caller's request. The request is built by
`toApiRequest`, so the test also covers current-time scheduling and milliseconds/kW
conversion to API seconds/watts. No real HTTP requests are made.

The remaining scenarios are descriptive TODO comments alongside that test, as
requested by the assignment.

`beforeEach` resets fake time, deterministic jitter, recorded requests, and mock
responses, then creates a fresh client, processor, and base setpoint. The test
declares its response sequence per URL; the shared adapter records each attempt
and returns HTTP 204 when no response is queued. `afterEach` restores spies and
real timers.
