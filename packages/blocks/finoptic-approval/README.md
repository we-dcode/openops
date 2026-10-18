# blocks-finoptic-approval

Finoptic supervisor approval gate. One action, `supervisor_approval`, which must be the first step of every Finoptic flow (Finoptic enforces this when it creates a flow, and its credential broker refuses to issue credentials for an execution that has no approval).

## How it pauses

Same mechanism as the core "Wait for Approval" block (`packages/blocks/approval/src/lib/actions/wait-for-approval.ts`):

- `ctx.run.pause({ pauseMetadata: { response: {} } })` on `ExecutionType.BEGIN` (hook in `packages/engine/src/lib/handler/block-executor.ts`, `createPauseHook`). The run goes to PAUSED.
- The run is resumed through `ANY /v1/flow-runs/:id/requests/:executionCorrelationId` (`packages/server/api/src/app/flows/flow-run/flow-run-controller.ts`, public route). The step runs again with `ExecutionType.RESUME` and `ctx.resumePayload.queryParams`.

## Contract with Finoptic

Env on the worker: `FINOPTIC_BACKEND_URL`, `FINOPTIC_BROKER_SECRET`. Header `X-Broker-Secret: $FINOPTIC_BROKER_SECRET` on every call. The JSON shapes are in the fixture `packages/blocks/finoptic-aws/test/fixtures/contract.json`, which the Finoptic backend tests too (Go, `internal/automations/broker/testdata/contract.json`). Keep the two files identical.

On BEGIN the block calls:

```
POST $FINOPTIC_BACKEND_URL/internal/automations/approvals
{ "executionId", "flowId", "flowRunId", "summary", "approveUrl", "rejectUrl" }
201 { "executionId", "status": "pending" }
```

Any 2xx = accepted, and the run pauses. Any other answer fails the step and nothing is paused.

`approveUrl` and `rejectUrl` come from `ctx.generateResumeUrl`:

```
<internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=approve&path=...
<internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=reject&path=...
```

They are sent only to Finoptic and are not part of the step output. The pause id is the key to resume the run, so Finoptic stores them encrypted, never logs them, and calls them only from its own org-admin decision endpoint (`POST .../automations/approvals/:executionId/decision`). Nothing else resumes a run.

On RESUME the query `action` is not trusted on its own. The block calls:

```
GET $FINOPTIC_BACKEND_URL/internal/automations/approvals/{executionId}
200 { "executionId", "status": "pending" | "approved" | "rejected" }
```

and continues with `{ approved: true }` only when `action=approve` AND `status` is `approved`. Anything else (`reject`, missing, unknown action, or a status other than `approved`) calls `ctx.run.stop`. If Finoptic cannot be reached or does not know the execution, the step fails: the run never goes on without a confirmed approval. So a direct hit on a resume URL cannot get a flow past this step.
