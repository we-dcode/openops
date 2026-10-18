# blocks-finoptic-aws

One action, `aws_call`, for Finoptic flows. `BlockAuth.None()`: there is no connection and no stored key.

Props: `executionId`, `credentialHandle` (sent to the broker as `handle`), `service` (e.g. `ec2`), `operation` (`DescribeInstances` or `describe-instances`), `params` (JSON).

## Credential path

Step inputs and outputs are written to the run log, and engines are pooled processes, so:

- The backend URL and secret are worker env (`FINOPTIC_BACKEND_URL`, `FINOPTIC_BROKER_SECRET`), never props. The region comes from the worker's `AWS_REGION`.
- The wire contract (below) is one JSON fixture, `test/fixtures/contract.json`, tested here (`test/contract.test.ts`) and in the Finoptic backend (Go, `internal/automations/broker/testdata/contract.json`). Keep the two files identical.
- The AWS SDK v3 client is created in memory per call and destroyed after it. Nothing is cached at module level and nothing is written to disk or `process.env`.
- The output is only the API result (`$metadata` removed). Credential fields (`AccessKeyId`, `SecretAccessKey`, `SessionToken`) and AKIA/ASIA-shaped strings are replaced with `[REDACTED]`, so an operation that returns credentials (`sts:AssumeRole`) does not put them in the log.
- Errors are rethrown as a new error with redacted text. Broker errors report the HTTP status only.

## Wire contract with the Finoptic backend

Header `X-Broker-Secret: $FINOPTIC_BROKER_SECRET` on every call.

```
POST $FINOPTIC_BACKEND_URL/internal/broker/resolve
{ "executionId": "...", "handle": "..." }
200 { "accessKeyId", "secretAccessKey", "sessionToken", "expiration" }   (expiration is RFC 3339)
403 { "error": "denied" }
```

The broker answers 403 (one generic error) when the handle is unknown, already used, expired, bound to another execution, or the execution has no APPROVED supervisor approval. A flow that skips `supervisor_approval` gets no credentials.

## Services

The block loads `@aws-sdk/client-<service>` at run time. Only clients installed in the image work; the root `package.json` has ec2, rds, s3, ssm, sts and more. Add a package there to allow another service.
