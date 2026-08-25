const SECRET_PATTERN_SOURCES: string[] = [
  "(?<![A-Za-z0-9_])(?:[A-Za-z0-9]+_)?api[_-]?key\\s*[:=]\\s*\\S+",
  "(?<![A-Za-z0-9_])aws.?secret.?access.?key\\s*[:=]\\s*\\S+",
  "\\bsecret\\s*[:=]\\s*\\S{8,}",
  "\\b(?:password|passwd)\\s*[:=]\\s*\\S{4,}",
  "\\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}\\b",
  "ghp_[A-Za-z0-9]{10,}",
  "AKIA[0-9A-Z]{16}",
  "-----BEGIN (?:RSA )?PRIVATE KEY-----",
  "Bearer\\s+[A-Za-z0-9\\-._~+/]+=*",
]

function compile(flags: string): RegExp {
  return new RegExp(SECRET_PATTERN_SOURCES.map((s) => `(${s})`).join("|"), flags)
}

// One compiled alternation per mode so scan and scrub can never drift apart.
const SECRET_SCAN_RE = compile("i")
const SECRET_SCRUB_RE = compile("gi")

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
  const m = text.match(SECRET_SCAN_RE)
  if (!m) return { safe: true }
  // Never echo the credential value back; keep only the identifier side of an
  // assignment match and fully redact bare token matches.
  const cut = m[0].search(/[:=]/)
  const matched = cut >= 0 ? `${m[0].slice(0, cut + 1)} [REDACTED]` : "[REDACTED]"
  return { safe: false, reason: "secret detected", matched }
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
  return text.replace(SECRET_SCRUB_RE, "[REDACTED]")
}
