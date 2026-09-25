/**
 * Masks anything that looks like a secret before text is shown in the UI.
 * Used for every piece of process output that crosses to the renderer.
 */
export const MASK = '••••••'

const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, // OpenAI, Stripe-style
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]

/** NAME=value or NAME: value where the name says it is secret. */
const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PRIVATE|CREDENTIAL|AUTH|DSN|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)(?!(?:Bearer|Basic)\b)([^\s"']+)\3/gi

/** Bearer / Basic authorization headers. */
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g

/** URLs with a password: scheme://user:password@host */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi

/** Long, mixed strings that look random (letters and digits, 32+ chars). */
const HIGH_ENTROPY = /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g

export function redact(text: string, knownSecrets: readonly string[] = []): string {
  let out = text
  // Exact values read from the project's .env files (never sent anywhere else).
  for (const secret of knownSecrets) {
    if (secret.length >= 6) out = out.split(secret).join(MASK)
  }
  for (const re of TOKEN_PATTERNS) out = out.replace(re, MASK)
  out = out.replace(AUTH_HEADER, (_m, kind: string) => `${kind} ${MASK}`)
  out = out.replace(SECRET_ASSIGNMENT, (_m, name: string, sep: string, q: string) => `${name}${sep}${q}${MASK}${q}`)
  out = out.replace(URL_PASSWORD, (_m, pre: string, _pw: string, at: string) => `${pre}${MASK}${at}`)
  out = out.replace(HIGH_ENTROPY, (m) => (/^[0-9a-f]{40}$/.test(m) ? m : MASK)) // keep git commit hashes
  return out
}
