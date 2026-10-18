import { ExecutionType } from '@openops/shared';
import { supervisorApproval } from '../src/lib/actions/supervisor-approval';

function ctx(
  executionType: ExecutionType,
  extra: Record<string, unknown> = {},
) {
  return {
    executionType,
    propsValue: {
      executionId: 'exec-1',
      flowId: 'flow-1',
      summary: 'Stop idle EC2',
    },
    run: { id: 'run-1', pause: jest.fn(), stop: jest.fn() },
    generateResumeUrl: jest.fn(
      ({ queryParams }) =>
        `http://app.internal/v1/flow-runs/run-1/requests/p1?action=${queryParams.action}`,
    ),
    ...extra,
  } as any;
}

describe('supervisor_approval', () => {
  beforeEach(() => {
    process.env['FINOPTIC_BACKEND_URL'] = 'http://backend.test';
    process.env['FINOPTIC_BROKER_SECRET'] = 'shared';
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 202 }) as any;
  });

  test('BEGIN posts the request with both resume urls, then pauses', async () => {
    const c = ctx(ExecutionType.BEGIN);
    const out = (await supervisorApproval.run(c)) as any;

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      'http://backend.test/internal/automations/approvals',
    );
    expect(init.headers.authorization).toBe('Bearer shared');
    expect(JSON.parse(init.body)).toEqual({
      executionId: 'exec-1',
      flowId: 'flow-1',
      summary: 'Stop idle EC2',
      flowRunId: 'run-1',
      approveUrl: expect.stringContaining('action=approve'),
      rejectUrl: expect.stringContaining('action=reject'),
    });
    expect(c.run.pause).toHaveBeenCalledTimes(1);
    expect(c.run.stop).not.toHaveBeenCalled();
    // resume urls are capabilities: they must not appear in the step output
    expect(JSON.stringify(out)).not.toContain('requests/');
  });

  test('BEGIN does not pause when Finoptic does not accept the request', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as any;
    const c = ctx(ExecutionType.BEGIN);
    await expect(supervisorApproval.run(c)).rejects.toThrow('HTTP 500');
    expect(c.run.pause).not.toHaveBeenCalled();
  });

  test('BEGIN fails closed without env', async () => {
    delete process.env['FINOPTIC_BACKEND_URL'];
    const c = ctx(ExecutionType.BEGIN);
    await expect(supervisorApproval.run(c)).rejects.toThrow(
      /FINOPTIC_BACKEND_URL/,
    );
    expect(c.run.pause).not.toHaveBeenCalled();
  });

  test('RESUME approve continues the flow', async () => {
    const c = ctx(ExecutionType.RESUME, {
      resumePayload: { queryParams: { action: 'approve' } },
    });
    expect(await supervisorApproval.run(c)).toEqual({ approved: true });
    expect(c.run.stop).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([['reject'], ['disapprove'], [undefined]])(
    'RESUME with action=%s stops the flow',
    async (action) => {
      const c = ctx(ExecutionType.RESUME, {
        resumePayload: { queryParams: action ? { action } : {} },
      });
      expect(await supervisorApproval.run(c)).toEqual({ approved: false });
      expect(c.run.stop).toHaveBeenCalledTimes(1);
    },
  );
});
