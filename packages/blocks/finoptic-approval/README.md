# blocks-finoptic-approval

Finoptic supervisor approval gate. One action, `supervisor_approval`, which must be the first step of every Finoptic flow (Finoptic enforces this when it creates a flow, and its credential broker refuses to issue credentials for an execution that has no approval).

## How it pauses

Same mechanism as the core "Wait for Approval" block (`packages/blocks/approval/src/lib/actions/wait-for-approval.ts`):

- `ctx.run.pause({ pauseMetadata: { response: {} } })` on `ExecutionType.BEGIN` (hook in `packages/engine/src/lib/handler/block-executor.ts`, `createPauseHook`). The run goes to PAUSED.
- The run is resumed through `ANY /v1/flow-runs/:id/requests/:executionCorrelationId` (`packages/server/api/src/app/flows/flow-run/flow-run-controller.ts`, public route). The step runs again with `ExecutionType.RESUME` and `ctx.resumePayload.queryParams`.

## Contract with Finoptic

Env on the worker: `FINOPTIC_BACKEND_URL`, `FINOPTIC_BROKER_SECRET`.

On BEGIN the block calls:

```
POST $FINOPTIC_BACKEND_URL/internal/automations/approvals
Authorization: Bearer $FINOPTIC_BROKER_SECRET
{ "executionId", "flowId", "summary", "flowRunId", "approveUrl", "rejectUrl" }
```

Any 2xx = accepted, and the run pauses. Any other answer fails the step and nothing is paused.

`approveUrl` and `rejectUrl` come from `ctx.generateResumeUrl`:

```
<internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=approve&path=...
<internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=reject&path=...
```

Finoptic sends the Slack interactive message (Donna). When the supervisor decides, Finoptic calls the matching URL (any method, no auth: the pause id is the key, so keep these URLs out of logs). The URLs are sent only to Finoptic and are not part of the step output.

On RESUME: `action=approve` continues the flow with `{ approved: true }`. Anything else (`reject`, missing, unknown) calls `ctx.run.stop`, so the rest of the flow does not run.
