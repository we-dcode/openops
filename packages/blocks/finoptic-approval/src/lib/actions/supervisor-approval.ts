import { createAction, Property } from '@openops/blocks-framework';
import { ExecutionType } from '@openops/shared';

export const APPROVALS_PATH = '/internal/automations/approvals';
export const SECRET_HEADER = 'X-Broker-Secret';

/**
 * Contract with Finoptic (the same JSON fixture is tested in both repos, see
 * test/fixtures in finoptic-aws and finoptic-infra's backend broker README)
 * ----------------------------------------------------------------------
 * Every call carries the header X-Broker-Secret: $FINOPTIC_BROKER_SECRET.
 *
 * On BEGIN the step asks Finoptic to put an approval in front of the
 * supervisor, then pauses the run (ctx.run.pause, the same mechanism the
 * core "Wait for Approval" block uses). Nothing runs until the run resumes.
 *
 *   POST $FINOPTIC_BACKEND_URL/internal/automations/approvals
 *   { executionId, flowId, flowRunId, summary, approveUrl, rejectUrl }
 *   201 = accepted. Anything else fails the step (the run stays unpaused).
 *
 * approveUrl and rejectUrl come from ctx.generateResumeUrl and go to Finoptic
 * only. They are not returned in the step output, so they do not reach the
 * run log. The unguessable pause id in the path is the key to resume, so
 * Finoptic stores them encrypted and calls them ONLY from its own admin
 * decision endpoint.
 *
 * On RESUME the query action is NOT trusted on its own. The block asks Finoptic:
 *
 *   GET $FINOPTIC_BACKEND_URL/internal/automations/approvals/{executionId}
 *   200 { executionId, status }  status = pending | approved | rejected
 *
 * and continues only when action=approve AND status is approved. Anything
 * else stops the flow. If Finoptic cannot be reached the step fails: the run
 * never continues on an unchecked approval.
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
    const baseUrl = process.env['FINOPTIC_BACKEND_URL'];
    const secret = process.env['FINOPTIC_BROKER_SECRET'];
    if (!baseUrl || !secret) {
      throw new Error(
        'FINOPTIC_BACKEND_URL and FINOPTIC_BROKER_SECRET must be set on the worker',
      );
    }

    const { executionId, flowId, summary } = ctx.propsValue;

    if (ctx.executionType === ExecutionType.RESUME) {
      const stop = () => {
        ctx.run.stop({ response: { body: { rejected: true } } });
        return { approved: false };
      };
      if (ctx.resumePayload.queryParams['action'] !== 'approve') {
        return stop();
      }
      // The URL alone is not proof: ask Finoptic whether an org admin approved.
      let check: Response;
      try {
        check = await fetch(
          new URL(
            `${APPROVALS_PATH}/${encodeURIComponent(executionId)}`,
            baseUrl,
          ),
          {
            method: 'GET',
            headers: { [SECRET_HEADER]: secret },
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        throw new Error('Finoptic approvals endpoint is unreachable');
      }
      if (!check.ok) {
        throw new Error(
          `Finoptic could not confirm the approval (HTTP ${check.status})`,
        );
      }
      const body = (await check.json()) as { status?: string };
      return body.status === 'approved' ? { approved: true } : stop();
    }

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
          [SECRET_HEADER]: secret,
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
