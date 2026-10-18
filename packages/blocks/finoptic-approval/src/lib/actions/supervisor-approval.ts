import { createAction, Property } from '@openops/blocks-framework';
import { ExecutionType } from '@openops/shared';

export const APPROVALS_PATH = '/internal/automations/approvals';

/**
 * Resume contract with Finoptic
 * ------------------------------
 * On BEGIN the step asks Finoptic to put an approval in front of the
 * supervisor, then pauses the run (ctx.run.pause, the same mechanism the
 * core "Wait for Approval" block uses). Nothing runs until the run resumes.
 *
 *   POST $FINOPTIC_BACKEND_URL/internal/automations/approvals
 *   Authorization: Bearer $FINOPTIC_BROKER_SECRET
 *   {
 *     executionId, flowId, summary,
 *     flowRunId,                // OpenOps run id
 *     approveUrl, rejectUrl     // resume URLs, see below
 *   }
 *   any 2xx = accepted. Anything else fails the step (the run stays unpaused).
 *
 * Finoptic resumes the run with a plain HTTP call to approveUrl or rejectUrl
 * (any method; no auth, the unguessable pause id in the path is the key):
 *   <internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=approve&path=...
 *   <internal api>/v1/flow-runs/{flowRunId}/requests/{pauseId}?action=reject&path=...
 * The URLs are made by ctx.generateResumeUrl and are sent to Finoptic only.
 * They are not returned in the step output, so they do not reach the run log.
 *
 * On RESUME: action=approve continues the flow; anything else stops it.
 */
export const supervisorApproval = createAction({
  name: 'supervisor_approval',
  displayName: 'Supervisor Approval (Finoptic)',
  description:
    'Must be the first step of every Finoptic flow. Asks the supervisor to approve and pauses the flow until they decide. A rejection stops the flow.',
  isWriteAction: false,
  errorHandlingOptions: {
    continueOnFailure: { hide: true },
    retryOnFailure: { hide: true },
  },
  props: {
    executionId: Property.ShortText({
      displayName: 'Execution ID',
      description: 'Finoptic automation execution id',
      required: true,
    }),
    flowId: Property.ShortText({
      displayName: 'Flow ID',
      description: 'Finoptic automation (flow) id',
      required: true,
    }),
    summary: Property.LongText({
      displayName: 'Summary',
      description: 'What this flow will do, shown to the supervisor',
      required: true,
    }),
  },
  async run(ctx) {
    if (ctx.executionType === ExecutionType.RESUME) {
      const approved = ctx.resumePayload.queryParams['action'] === 'approve';
      if (!approved) {
        ctx.run.stop({ response: { body: { rejected: true } } });
        return { approved: false };
      }
      return { approved: true };
    }

    const baseUrl = process.env['FINOPTIC_BACKEND_URL'];
    const secret = process.env['FINOPTIC_BROKER_SECRET'];
    if (!baseUrl || !secret) {
      throw new Error(
        'FINOPTIC_BACKEND_URL and FINOPTIC_BROKER_SECRET must be set on the worker',
      );
    }

    const { executionId, flowId, summary } = ctx.propsValue;
    const approveUrl = ctx.generateResumeUrl({
      queryParams: { action: 'approve' },
    });
    const rejectUrl = ctx.generateResumeUrl({
      queryParams: { action: 'reject' },
    });

    let response: Response;
    try {
      response = await fetch(new URL(APPROVALS_PATH, baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          executionId,
          flowId,
          summary,
          flowRunId: ctx.run.id,
          approveUrl,
          rejectUrl,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('Finoptic approvals endpoint is unreachable');
    }
    if (!response.ok) {
      throw new Error(
        `Finoptic did not accept the approval request (HTTP ${response.status})`,
      );
    }

    ctx.run.pause({ pauseMetadata: { response: {} } });
    return { approved: false, pending: true }; // not final: the run is paused
  },
});
