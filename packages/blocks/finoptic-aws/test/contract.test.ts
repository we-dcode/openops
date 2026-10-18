import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fetchCredentials,
  RESOLVE_PATH,
  SECRET_HEADER,
} from '../src/lib/broker';

// The wire contract with the Finoptic backend. The same file is checked in to
// finoptic-infra's backend (internal/automations/broker/testdata/contract.json)
// and tested there with Go. Keep the two files identical.
const contract = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'contract.json'), 'utf8'),
);

describe('broker contract fixture', () => {
  beforeEach(() => {
    process.env['FINOPTIC_BACKEND_URL'] = 'http://backend.test';
    process.env['FINOPTIC_BROKER_SECRET'] = 'shared';
  });

  test('path and header match the fixture', () => {
    expect(RESOLVE_PATH).toBe(contract.resolve.path);
    expect(SECRET_HEADER).toBe(contract.secretHeader);
  });

  test('the request the block sends is exactly the fixture request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => contract.resolve.response,
    }) as any;

    await fetchCredentials(
      contract.resolve.request.executionId,
      contract.resolve.request.handle,
    );

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(`http://backend.test${contract.resolve.path}`);
    expect(init.method).toBe('POST');
    expect(init.headers[contract.secretHeader]).toBe('shared');
    expect(JSON.parse(init.body)).toEqual(contract.resolve.request);
  });

  test('the fixture response parses with every field the backend sends', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => contract.resolve.response,
    }) as any;

    const creds = await fetchCredentials('exec-1', 'h');

    expect(creds).toEqual(contract.resolve.response);
    expect(Object.keys(creds).sort()).toEqual(
      Object.keys(contract.resolve.response).sort(),
    );
  });
});
