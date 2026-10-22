# Tests

Run `npm test`. The single implemented test in `batteredBatteries.test.ts` exercises
the API client's 429 Retry-After and 500 backoff path through a mocked Axios adapter.
It also checks the outgoing request and that retries preserve expiry while refreshing
the future start time. No real HTTP requests are made.

The remaining scenarios are descriptive TODO comments alongside that test, as
requested by the assignment.
