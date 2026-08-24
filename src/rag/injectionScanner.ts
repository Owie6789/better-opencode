const ALNUM = "A-Za-z0-9"
const SECRET_PATTERNS: RegExp[] = [
  new RegExp("(?:^|[^" + ALNUM + "_])(?:[" + ALNUM + "]+_)?api[_-]?key\\s*[:=]\\s*\\S+", "i"),
  /\bsecret\s*[:=]\s*\S{8,}/i,
  /\b(password|passwd)\s*[:=]\s*\S{4,}/i,
  new RegExp("\\bsk-(?:[" + ALNUM + "]+-)*[" + ALNUM + "]{16,}\\b"),
  new RegExp("ghp_[" + ALNUM + "]{10,}"),
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA )?PRIVATE KEY-----/,
  new RegExp("Bearer\\s+[" + ALNUM + "\\-._~+/]+=*"),
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

export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, "gi"), "[REDACTED]")
  }
  return out
}
