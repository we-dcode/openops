export type BrokerCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
};

export class BrokerError extends Error {}

/**
 * Asks the Finoptic credential broker for short-lived credentials.
 *
 * Contract (Finoptic side):
 *   POST $FINOPTIC_BROKER_URL
 *   Authorization: Bearer $FINOPTIC_BROKER_SECRET
 *   {"executionId": "...", "credentialHandle": "..."}
 *   200 {"accessKeyId", "secretAccessKey", "sessionToken"?, "region"?}
 * The broker refuses (403) when the execution has no approved supervisor
 * approval, so a flow that skips the approval step gets no credentials.
 *
 * URL and secret come from the worker environment, never from step props
 * (props are written to the run log). Nothing here is cached.
 */
export async function fetchCredentials(
  executionId: string,
  credentialHandle: string,
): Promise<BrokerCredentials> {
  const url = process.env['FINOPTIC_BROKER_URL'];
  const secret = process.env['FINOPTIC_BROKER_SECRET'];
  if (!url || !secret) {
    throw new BrokerError(
      'FINOPTIC_BROKER_URL and FINOPTIC_BROKER_SECRET must be set on the worker',
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ executionId, credentialHandle }),
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
  if (!body.accessKeyId || !body.secretAccessKey) {
    throw new BrokerError('Credential broker returned an incomplete response');
  }
  return {
    accessKeyId: body.accessKeyId,
    secretAccessKey: body.secretAccessKey,
    sessionToken: body.sessionToken,
    region: body.region,
  };
}
