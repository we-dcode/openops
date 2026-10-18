export const REDACTED = '[REDACTED]';

const CREDENTIAL_KEY = /^(accesskeyid|secretaccesskey|sessiontoken)$/i;

// key: value / key=value / "key":"value" in free text (error messages, JSON)
const KEY_VALUE_PATTERN =
  /(AccessKeyId|SecretAccessKey|SessionToken|aws_access_key_id|aws_secret_access_key|aws_session_token)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;

// AWS key id shapes: long-term (AKIA), temporary (ASIA), and the other
// IAM unique-id prefixes that identify a principal's key material.
const KEY_ID_PATTERN =
  /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{12,}\b/g;

// Session tokens from STS are long base64 blobs; catch a bare one too. Only
// for error text: in API results a long base64 string can be legitimate data
// (EC2 user data, for one).
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9+/=]{100,}\b/g;

/**
 * Removes anything that looks like AWS credential material from text.
 * `known` are exact values (the credentials we just fetched, the broker
 * secret) that are removed wherever they appear, whatever their shape.
 */
export function redactText(
  text: string,
  known: string[] = [],
  { bareTokens = false }: { bareTokens?: boolean } = {},
): string {
  let out = text;
  for (const value of known) {
    if (value && value.length >= 8) {
      out = out.split(value).join(REDACTED);
    }
  }
  out = out
    .replace(KEY_VALUE_PATTERN, `$1$2${REDACTED}`)
    .replace(KEY_ID_PATTERN, REDACTED);
  return bareTokens ? out.replace(LONG_TOKEN_PATTERN, REDACTED) : out;
}

/**
 * Deep copy of an API result with credential fields and credential-shaped
 * strings replaced. An operation that legitimately returns credentials
 * (sts AssumeRole, iam CreateAccessKey) must not put them in the run log.
 */
export function redactValue(value: unknown, known: string[] = []): unknown {
  if (typeof value === 'string') {
    return redactText(value, known);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, known));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = CREDENTIAL_KEY.test(k) ? REDACTED : redactValue(v, known);
    }
    return out;
  }
  return value;
}
