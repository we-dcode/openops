export type BrokerCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
};

export class BrokerError extends Error {}

export const RESOLVE_PATH = '/internal/broker/resolve';
export const SECRET_HEADER = 'X-Broker-Secret';

/**
 * Asks the Finoptic credential broker for short-lived credentials.
 *
 * Contract (the same JSON fixture is tested in both repos, see
 * test/fixtures/contract.json and finoptic-infra's backend broker README):
 *   POST $FINOPTIC_BACKEND_URL/internal/broker/resolve
 *   X-Broker-Secret: $FINOPTIC_BROKER_SECRET
 *   {"executionId": "...", "handle": "..."}
 *   200 {"accessKeyId", "secretAccessKey", "sessionToken", "expiration"}
 * The broker refuses (403) when the handle is unknown, used, expired, or the
 * execution has no approved supervisor approval, so a flow that skips the
 * approval step gets no credentials. The handle works once.
 *
 * URL and secret come from the worker environment, never from step props
 * (props are written to the run log). Nothing here is cached.
 */
export async function fetchCredentials(
  executionId: string,
  handle: string,
): Promise<BrokerCredentials> {
  const baseUrl = process.env['FINOPTIC_BACKEND_URL'];
  const secret = process.env['FINOPTIC_BROKER_SECRET'];
  if (!baseUrl || !secret) {
    throw new BrokerError(
      'FINOPTIC_BACKEND_URL and FINOPTIC_BROKER_SECRET must be set on the worker',
    );
  }

  let response: Response;
  try {
    response = await fetch(new URL(RESOLVE_PATH, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SECRET_HEADER]: secret,
      },
      body: JSON.stringify({ executionId, handle }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BrokerError('Credential broker is unreachable');
  }

  if (!response.ok) {
    // Status only: the body of a broker error is not trusted to be free of
    // secrets, and the caller only needs to know it was refused.
    throw new BrokerError(
      `Credential broker refused the request (HTTP ${response.status})`,
    );
  }

  const body = (await response.json()) as Partial<BrokerCredentials>;
  if (!body.accessKeyId || !body.secretAccessKey || !body.sessionToken) {
    throw new BrokerError('Credential broker returned an incomplete response');
  }
  return {
    accessKeyId: body.accessKeyId,
    secretAccessKey: body.secretAccessKey,
    sessionToken: body.sessionToken,
    expiration: body.expiration ?? '',
  };
}
