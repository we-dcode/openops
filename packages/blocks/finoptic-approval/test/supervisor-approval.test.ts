import { ExecutionType } from '@openops/shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import { supervisorApproval } from '../src/lib/actions/supervisor-approval';

// Shared with the Finoptic backend, which tests the same file with Go.
const contract = JSON.parse(
  readFileSync(
    join(__dirname, '../../finoptic-aws/test/fixtures/contract.json'),
    'utf8',
  ),
);

function statusReply(status: string, ok = true, code = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status: code,
    json: async () => ({ executionId: 'exec-1', status }),
  }) as any;
}

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
      .mockResolvedValue({ ok: true, status: 201 }) as any;
  });

  test('BEGIN posts the request with both resume urls, then pauses', async () => {
    const c = ctx(ExecutionType.BEGIN);
    const out = (await supervisorApproval.run(c)) as any;

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      'http://backend.test/internal/automations/approvals',
    );
    expect(init.headers['X-Broker-Secret']).toBe('shared');
    expect(init.headers.authorization).toBeUndefined();
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

  test('RESUME approve continues only after Finoptic confirms approved', async () => {
    global.fetch = statusReply('approved');
    const c = ctx(ExecutionType.RESUME, {
      resumePayload: { queryParams: { action: 'approve' } },
    });
    expect(await supervisorApproval.run(c)).toEqual({ approved: true });
    expect(c.run.stop).not.toHaveBeenCalled();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      'http://backend.test/internal/automations/approvals/exec-1',
    );
    expect(init.method).toBe('GET');
    expect(init.headers['X-Broker-Secret']).toBe('shared');
  });

  test.each([['pending'], ['rejected'], ['something-else']])(
    'RESUME action=approve with Finoptic status %s stops the flow',
    async (status) => {
      global.fetch = statusReply(status);
      const c = ctx(ExecutionType.RESUME, {
        resumePayload: { queryParams: { action: 'approve' } },
      });
      expect(await supervisorApproval.run(c)).toEqual({ approved: false });
      expect(c.run.stop).toHaveBeenCalledTimes(1);
    },
  );

  test('RESUME fails closed when Finoptic cannot confirm', async () => {
    const c = ctx(ExecutionType.RESUME, {
      resumePayload: { queryParams: { action: 'approve' } },
    });
    global.fetch = statusReply('approved', false, 404);
    await expect(supervisorApproval.run(c)).rejects.toThrow('HTTP 404');
    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as any;
    await expect(supervisorApproval.run(c)).rejects.toThrow('unreachable');
    expect(c.run.stop).not.toHaveBeenCalled();
  });

  test.each([['reject'], ['disapprove'], [undefined]])(
    'RESUME with action=%s stops the flow without asking',
    async (action) => {
      const c = ctx(ExecutionType.RESUME, {
        resumePayload: { queryParams: action ? { action } : {} },
      });
      expect(await supervisorApproval.run(c)).toEqual({ approved: false });
      expect(c.run.stop).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});

describe('approval contract fixture', () => {
  beforeEach(() => {
    process.env['FINOPTIC_BACKEND_URL'] = 'http://backend.test';
    process.env['FINOPTIC_BROKER_SECRET'] = 'shared';
  });

  test('the create request is exactly the fixture request', async () => {
    const req = contract.approvalCreate.request;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 201 }) as any;
    const c = ctx(ExecutionType.BEGIN, {
      propsValue: {
        executionId: req.executionId,
        flowId: req.flowId,
        summary: req.summary,
      },
      run: { id: req.flowRunId, pause: jest.fn(), stop: jest.fn() },
      generateResumeUrl: ({ queryParams }: any) =>
        queryParams.action === 'approve' ? req.approveUrl : req.rejectUrl,
    });
    await supervisorApproval.run(c);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      `http://backend.test${contract.approvalCreate.path}`,
    );
    expect(init.headers[contract.secretHeader]).toBe('shared');
    expect(JSON.parse(init.body)).toEqual(req);
  });

  test('the status check reads the fixture response shape and path', async () => {
    const res = contract.approvalStatus.response;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => res,
    }) as any;
    const c = ctx(ExecutionType.RESUME, {
      propsValue: { executionId: res.executionId, flowId: 'f', summary: 's' },
      resumePayload: { queryParams: { action: 'approve' } },
    });
    expect(await supervisorApproval.run(c)).toEqual({ approved: true });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      'http://backend.test' +
        contract.approvalStatus.pathTemplate.replace(
          '{executionId}',
          res.executionId,
        ),
    );
  });
});
