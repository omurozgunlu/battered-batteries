# Tests

Run `npm test`. The single implemented test in `forwardSetpoints.test.ts` exercises
`createForwardSetpoints` with two valid messages separated by a malformed message.
It checks that:

- The handler completes successfully despite the malformed entry.
- The processor is called exactly once with the valid messages in their original
  order, mapped to flat `SetPoint` values with millisecond timestamps.
- The warning contains the malformed entry's index and validation issues without
  including its raw payload.

`beforeEach` resets the processor and logger mocks and creates an `InvocationContext`
with the mocked logger. The real schema and mapper run; the processor is injected
as a mock. No Azure host, credentials, HTTP adapters, or fake timers are needed.

API client, processor, and other handler scenarios remain descriptive TODO comments
alongside the test, as requested by the assignment. The previous client's retry,
expiry, and request-format scenarios are included in those TODOs.
