const send = jest.fn();
const destroy = jest.fn();
const clientCtor = jest.fn();

class FakeClient {
  constructor(config: unknown) {
    clientCtor(config);
  }
  send = send;
  destroy = destroy;
}
class DescribeInstancesCommand {
  constructor(public input: unknown) {}
}

jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: FakeClient,
  DescribeInstancesCommand,
}));

import { awsCall } from '../src/lib/actions/aws-call';

const CREDS = {
  accessKeyId: 'ASIATESTKEYID123456',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: 'FwoGZXIvYXdzEXAMPLETOKEN/with+chars==',
  expiration: '2033-05-18T03:33:20Z',
};

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    propsValue: {
      executionId: 'exec-1',
      credentialHandle: 'handle-1',
      service: 'ec2',
      operation: 'DescribeInstances',
      params: { MaxResults: 5 },
      ...overrides,
    },
  } as any;
}

function brokerReturns(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any;
}

describe('aws_call', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['FINOPTIC_BACKEND_URL'] = 'http://broker.test';
    process.env['AWS_REGION'] = 'eu-west-1';
    process.env['FINOPTIC_BROKER_SECRET'] = 'broker-shared-secret';
  });

  test('sends handle + secret from env, calls AWS, returns only the API result', async () => {
    brokerReturns(CREDS);
    send.mockResolvedValue({
      Reservations: [{ Instances: [{ InstanceId: 'i-1' }] }],
      $metadata: { requestId: 'r', httpStatusCode: 200 },
    });

    const result = await awsCall.run(ctx());

    expect(result).toEqual({
      Reservations: [{ Instances: [{ InstanceId: 'i-1' }] }],
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('http://broker.test/internal/broker/resolve');
    expect(init.headers['X-Broker-Secret']).toBe('broker-shared-secret');
    expect(JSON.parse(init.body)).toEqual({
      executionId: 'exec-1',
      handle: 'handle-1',
    });
    expect(clientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-1' }),
    );
    expect(send.mock.calls[0][0].input).toEqual({ MaxResults: 5 });
    expect(destroy).toHaveBeenCalled();
  });

  test('accepts kebab-case operation names', async () => {
    brokerReturns(CREDS);
    send.mockResolvedValue({});
    await awsCall.run(ctx({ operation: 'describe-instances' }));
    expect(send.mock.calls[0][0]).toBeInstanceOf(DescribeInstancesCommand);
  });

  test('credentials returned by the API are redacted from the output', async () => {
    brokerReturns(CREDS);
    send.mockResolvedValue({
      Credentials: {
        AccessKeyId: 'ASIAOTHERKEY1234567',
        SecretAccessKey: 'othersecret',
        SessionToken: 'othertoken',
      },
      Echo: CREDS.secretAccessKey,
    });
    const out = JSON.stringify(await awsCall.run(ctx()));
    expect(out).not.toMatch(/ASIA|othersecret|othertoken|wJalr/);
  });

  test('credentials in an SDK error are redacted from the thrown error', async () => {
    brokerReturns(CREDS);
    send.mockRejectedValue(
      Object.assign(
        new Error(
          `denied for ${CREDS.accessKeyId} secret ${CREDS.secretAccessKey} SessionToken=${CREDS.sessionToken} AKIAABCDEFGHIJKLMNOP`,
        ),
        { name: 'UnauthorizedOperation' },
      ),
    );
    const error = (await awsCall.run(ctx()).catch((e: Error) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    const text = `${error.message}\n${error.stack}`;
    expect(text).not.toMatch(/ASIATEST|AKIAABCD|wJalr|FwoGZ/);
    expect(error.message).toContain('UnauthorizedOperation');
    expect(destroy).toHaveBeenCalled();
  });

  test('a refused broker call fails without echoing the broker body or secret', async () => {
    brokerReturns({ error: 'broker-shared-secret leaked?' }, 403);
    const error = (await awsCall.run(ctx()).catch((e: Error) => e)) as Error;
    expect(error.message).toContain('HTTP 403');
    expect(error.message).not.toContain('broker-shared-secret');
    expect(send).not.toHaveBeenCalled();
  });

  test('fails closed when the broker env is missing', async () => {
    delete process.env['FINOPTIC_BACKEND_URL'];
    global.fetch = jest.fn() as any;
    await expect(awsCall.run(ctx())).rejects.toThrow(/FINOPTIC_BACKEND_URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects service names that are not plain client names', async () => {
    global.fetch = jest.fn() as any;
    await expect(awsCall.run(ctx({ service: '../x' }))).rejects.toThrow(
      'Invalid service name',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetches fresh credentials on every call (no caching)', async () => {
    brokerReturns(CREDS);
    send.mockResolvedValue({});
    await awsCall.run(ctx());
    await awsCall.run(ctx());
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(clientCtor).toHaveBeenCalledTimes(2);
  });
});
