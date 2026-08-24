const SECRET_PATTERNS: RegExp[] = [
  /(?:^|\W)(?:[A-Za-z0-9]+_)?api[_-]?key\s*[:=]\s*\S+/i, // NOSONAR - character class intentionally covers env-prefixed api keys (OPENAI_API_KEY) plus fallback
  /aws_secret_access_key\s*[:=]\s*\S+/i, // NOSONAR - literal AWS key name
  /aws.?secret.?access.?key\s*[:=]\s*\S+/i, // NOSONAR - flexible AWS key variant
  /\bsecret\s*[:=]\s*\S{8,}/i,
  /\b(?:password|passwd)\s*[:=]\s*\S{4,}/i,
  /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}\b/, // NOSONAR - sk-proj hyphenated token intentionally duplicated class for readability
  /ghp_[A-Za-z0-9]{10,}/, // NOSONAR - GitHub token prefix
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/, // NOSONAR - RFC6750 bearer charset includes escaped slash for regex literal delimiter
]

const INJECTION_PATTERNS: RegExp[] = [
  /ignore previous instructions/i,
  /system prompt/i,
  /jailbreak/i,
  /```.*opencode/i,
]

export interface ScanResult {
  safe: boolean
  reason?: string
  matched?: string
}

export function scanForSecrets(text: string): ScanResult {
  for (const re of SECRET_PATTERNS) {
    const m = text.match(re)
    if (m) return { safe: false, reason: "secret detected", matched: m[0].slice(0, 40) }
  }
  return { safe: true }
}

export function scanForInjection(text: string): ScanResult {
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re)
    if (m) return { safe: false, reason: "injection detected", matched: m[0].slice(0, 40) }
  }
  return { safe: true }
}

export function scanSkillText(text: string): ScanResult {
  const secret = scanForSecrets(text)
  if (!secret.safe) return secret
  const inject = scanForInjection(text)
  if (!inject.safe) return inject
  return { safe: true }
}

const SCRUB_PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9_])(?:[A-Za-z0-9]+_)?api[_-]?key\s*[:=]\s*\S+/gi, // NOSONAR - lookbehind preserves delimiter
  /(?<![A-Za-z0-9_])aws_secret_access_key\s*[:=]\s*\S+/gi, // NOSONAR
  /(?<![A-Za-z0-9_])aws.?secret.?access.?key\s*[:=]\s*\S+/gi, // NOSONAR
  /\bsecret\s*[:=]\s*\S{8,}/gi,
  /\b(?:password|passwd)\s*[:=]\s*\S{4,}/gi,
  /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}\b/gi, // NOSONAR
  /ghp_[A-Za-z0-9]{10,}/gi, // NOSONAR
  /AKIA[0-9A-Z]{16}/gi,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/gi,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, // NOSONAR
]

export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SCRUB_PATTERNS) {
    out = out.replace(re, "[REDACTED]")
  }
  return out
}
