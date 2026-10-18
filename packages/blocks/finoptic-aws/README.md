# blocks-finoptic-aws

One action, `aws_call`, for Finoptic flows. `BlockAuth.None()`: there is no connection and no stored key.

Props: `executionId`, `credentialHandle`, `service` (e.g. `ec2`), `operation` (`DescribeInstances` or `describe-instances`), `params` (JSON).

## Credential path

Step inputs and outputs are written to the run log, and engines are pooled processes, so:

- The broker URL and secret are worker env (`FINOPTIC_BROKER_URL`, `FINOPTIC_BROKER_SECRET`), never props.
- `POST $FINOPTIC_BROKER_URL` with `Authorization: Bearer $FINOPTIC_BROKER_SECRET` and `{ executionId, credentialHandle }` returns `{ accessKeyId, secretAccessKey, sessionToken?, region? }`. The broker answers 403 when the execution has no approved supervisor approval.
- The AWS SDK v3 client is created in memory per call and destroyed after it. Nothing is cached at module level and nothing is written to disk or `process.env`.
- The output is only the API result (`$metadata` removed). Credential fields (`AccessKeyId`, `SecretAccessKey`, `SessionToken`) and AKIA/ASIA-shaped strings are replaced with `[REDACTED]`, so an operation that returns credentials (`sts:AssumeRole`) does not put them in the log.
- Errors are rethrown as a new error with redacted text. Broker errors report the HTTP status only.

## Services

The block loads `@aws-sdk/client-<service>` at run time. Only clients installed in the image work; the root `package.json` has ec2, rds, s3, ssm, sts and more. Add a package there to allow another service.
