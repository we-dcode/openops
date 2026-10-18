import { redactText, redactValue } from '../src/lib/redact';

describe('redactText', () => {
  test('removes key ids and key=value pairs', () => {
    const text =
      'bad creds ASIAABCDEFGHIJKLMNOP and AKIAABCDEFGHIJKLMNOP; SecretAccessKey=abc123/XYZ+secret AccessKeyId: "ASIAZZZZZZZZZZZZZZZZ" "SessionToken":"tok/en+value=="';
    const out = redactText(text);
    expect(out).not.toMatch(/ASIA|AKIA|abc123|tok\/en/);
    expect(out).toContain('[REDACTED]');
  });

  test('removes known exact values of any shape', () => {
    expect(
      redactText('boom my-odd-secret-value!', ['my-odd-secret-value!']),
    ).toBe('boom [REDACTED]');
  });

  test('bare long tokens only when asked', () => {
    const token = 'A'.repeat(120);
    expect(redactText(`x ${token}`)).toContain(token);
    expect(redactText(`x ${token}`, [], { bareTokens: true })).not.toContain(
      token,
    );
  });
});

describe('redactValue', () => {
  test('blanks credential fields at any depth and keeps the rest', () => {
    const out = redactValue({
      Credentials: {
        AccessKeyId: 'ASIAABCDEFGHIJKLMNOP',
        SecretAccessKey: 's3cr3t',
        SessionToken: 'tok',
        Expiration: new Date('2030-01-01T00:00:00Z'),
      },
      Items: [{ Name: 'ok', Note: 'key AKIAABCDEFGHIJKLMNOP here' }],
    });
    expect(JSON.stringify(out)).not.toMatch(/ASIA|AKIA|s3cr3t|"tok"/);
    expect((out as any).Items[0].Name).toBe('ok');
    expect((out as any).Credentials.Expiration).toBe(
      '2030-01-01T00:00:00.000Z',
    );
  });
});
