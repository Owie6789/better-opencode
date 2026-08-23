import type { RepoProfile } from "../types.js"
import { FingerprintStore } from "../stores/fingerprint.js"
import { Logger } from "../utils/logger.js"
import { scanRepo } from "./repoScanner.js"

export interface DriftResult {
  drifted: boolean
  reason?: string
  current: RepoProfile
  previousHash?: string
  currentHash?: string
  needsReinterview: boolean
}

export class DriftDetector {
  private fpStore: FingerprintStore

  constructor(
    private readonly driftThreshold = 0.3,
    private readonly logger: Logger = new Logger(false),
  ) {
    this.fpStore = new FingerprintStore(undefined, logger)
  }

  async check(repoRoot: string, previousProfile?: RepoProfile): Promise<DriftResult> {
    const current = await scanRepo(repoRoot)
    const currFp = await this.fpStore.compute(repoRoot)
    const prevFp = this.fpStore.load(repoRoot)

    if (!prevFp) {
      this.fpStore.save(repoRoot, { ...currFp, profile: current })
      return { drifted: false, current, currentHash: currFp.hash, needsReinterview: false }
    }

    if (currFp.hash === prevFp.hash) {
      return { drifted: false, current, previousHash: prevFp.hash, currentHash: currFp.hash, needsReinterview: false }
    }

    const prevDeps = prevFp.profile?.deps ?? previousProfile?.deps ?? {}
    const currDeps = current.deps
    const depDrift = this.depsDiff(prevDeps, currDeps)

    const fileDelta = prevFp.fileCount === 0 ? 0 : Math.abs(currFp.fileCount - prevFp.fileCount) / prevFp.fileCount

    const drifted = depDrift > this.driftThreshold || fileDelta > 0.2

    if (drifted) {
      this.logger.info(`Drift detected depDrift=${depDrift.toFixed(2)} fileDelta=${fileDelta.toFixed(2)}`)
    }

    if (drifted) {
      this.fpStore.save(repoRoot, { ...currFp, profile: current })
    }

    return {
      drifted,
      reason: drifted ? `deps diff ${depDrift.toFixed(2)} file delta ${fileDelta.toFixed(2)}` : undefined,
      current,
      previousHash: prevFp.hash,
      currentHash: currFp.hash,
      needsReinterview: drifted,
    }
  }

  private depsDiff(a: Record<string, string>, b: Record<string, string>): number {
    return depsDiff(a, b)
  }
}

export function depsDiff(a: Record<string, string>, b: Record<string, string>): number {
  const setA = new Set(Object.keys(a))
  const setB = new Set(Object.keys(b))
  if (setA.size === 0 && setB.size === 0) return 0
  let inter = 0
  for (const k of setA) if (setB.has(k)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : 1 - inter / union
}

export function computeDrift(prev: { hash: string; fileCount: number; depsHash: string; profile?: { deps: Record<string, string> } }, cur: { hash: string; fileCount: number; depsHash: string; profile?: { deps: Record<string, string> } }): { drifted: boolean; depsDiff: number; fileDelta: number; hashChanged: boolean; prevHash: string; curHash: string } {
  const dDiff = depsDiff(prev.profile?.deps ?? {}, cur.profile?.deps ?? {})
  const fileDelta = prev.fileCount === 0 ? 0 : Math.abs(cur.fileCount - prev.fileCount) / prev.fileCount
  return { drifted: prev.hash !== cur.hash && (dDiff > 0.3 || fileDelta > 0.2), depsDiff: dDiff, fileDelta, hashChanged: prev.hash !== cur.hash, prevHash: prev.hash, curHash: cur.hash }
}

export function needsReinterview(drift: { drifted: boolean }, lastInterviewMs: number, thresholdDays = 7): boolean {
  if (!drift.drifted) return false
  const age = Date.now() - lastInterviewMs
  return age > thresholdDays * 24 * 60 * 60 * 1000
}
