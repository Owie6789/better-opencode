const SECRET_PATTERNS: RegExp[] = [
  /(?:^|\W)(?:[A-Za-z0-9]+_)?api[_-]?key\s*[:=]\s*\S+/i,
  /aws_secret_access_key\s*[:=]\s*\S+/i,
  /aws.?secret.?access.?key\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S{8,}/i,
  /\b(?:password|passwd)\s*[:=]\s*\S{4,}/i,
  /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}\b/,
  /ghp_[A-Za-z0-9]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/,
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
  /(?:^|\W)(?:[A-Za-z0-9]+_)?api[_-]?key\s*[:=]\s*\S+/gi,
  /aws_secret_access_key\s*[:=]\s*\S+/gi,
  /aws.?secret.?access.?key\s*[:=]\s*\S+/gi,
  /\bsecret\s*[:=]\s*\S{8,}/gi,
  /\b(?:password|passwd)\s*[:=]\s*\S{4,}/gi,
  /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}\b/gi,
  /ghp_[A-Za-z0-9]{10,}/gi,
  /AKIA[0-9A-Z]{16}/gi,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/gi,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
]

export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SCRUB_PATTERNS) {
    out = out.replace(re, "[REDACTED]")
  }
  return out
}
