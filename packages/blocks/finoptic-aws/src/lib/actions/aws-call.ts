import { createAction, Property } from '@openops/blocks-framework';
import { BrokerCredentials, fetchCredentials } from '../broker';
import { redactText, redactValue } from '../redact';

const SERVICE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9-_]*$/;

function toPascalCase(operation: string): string {
  return operation
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

function loadSdk(service: string): Record<string, unknown> {
  try {
    // Dynamic on purpose: Finoptic flows name the service. The name is
    // validated above, and only packages installed in the image can load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(`@aws-sdk/client-${service}`);
  } catch {
    throw new Error(
      `AWS service "${service}" is not available in this image (no @aws-sdk/client-${service})`,
    );
  }
}

export const awsCall = createAction({
  name: 'aws_call',
  displayName: 'AWS Call (Finoptic)',
  description:
    'Runs one AWS API call with short-lived credentials from the Finoptic broker. Credentials never reach the run log.',
  isWriteAction: true,
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
    credentialHandle: Property.ShortText({
      displayName: 'Credential handle',
      description:
        'Opaque handle the Finoptic broker exchanges for credentials',
      required: true,
    }),
    service: Property.ShortText({
      displayName: 'Service',
      description: 'AWS SDK v3 client name, e.g. ec2, rds, s3',
      required: true,
    }),
    operation: Property.ShortText({
      displayName: 'Operation',
      description:
        'API operation, e.g. DescribeInstances or describe-instances',
      required: true,
    }),
    params: Property.Json({
      displayName: 'Parameters',
      description: 'Input of the API call',
      required: false,
      defaultValue: {},
    }),
  },
  async run(ctx) {
    const { executionId, credentialHandle, service, operation, params } =
      ctx.propsValue;

    if (!SERVICE_PATTERN.test(service)) {
      throw new Error('Invalid service name');
    }
    if (!OPERATION_PATTERN.test(operation)) {
      throw new Error('Invalid operation name');
    }

    let creds: BrokerCredentials | undefined;
    // Anything that must never appear in text we hand back to OpenOps.
    let known: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;
    try {
      creds = await fetchCredentials(executionId, credentialHandle);
      known = [
        creds.accessKeyId,
        creds.secretAccessKey,
        creds.sessionToken ?? '',
      ];

      const sdk = loadSdk(service);
      const clientName = Object.keys(sdk).find(
        (k) => k.endsWith('Client') && typeof sdk[k] === 'function',
      );
      const commandName = `${toPascalCase(operation)}Command`;
      const Command = sdk[commandName] as AnyCtor | undefined;
      if (!clientName || typeof Command !== 'function') {
        throw new Error(`Unknown operation ${service}.${operation}`);
      }

      const Client = sdk[clientName] as AnyCtor;
      client = new Client({
        region: creds.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
        },
      });

      const result = await client.send(new Command(params ?? {}));
      const { $metadata: _metadata, ...apiResult } = result ?? {};
      return redactValue(apiResult, known);
    } catch (error) {
      // A new Error: the original can carry request details, and its stack
      // is not ours to publish. Message and name go through redaction.
      const e = error as { name?: string; message?: string };
      const message = redactText(
        `${e?.name ?? 'Error'}: ${e?.message ?? 'call failed'}`,
        known,
        { bareTokens: true },
      );
      throw new Error(`AWS ${service}.${operation} failed: ${message}`);
    } finally {
      client?.destroy?.();
      creds = undefined;
      known = [];
    }
  },
});
