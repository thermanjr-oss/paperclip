import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  findStalled,
  lastTouchTime,
  nudgeBody,
  resolveConfig,
  type FinishLineConfig,
  type StalledIssue,
} from "./stale.js";

export const SCAN_JOB_KEY = "scan-stalled";
export const STALLED_STATE_KEY = "stalled";
export const NUDGE_STATE_KEY = "nudge";
const PAGE_SIZE = 100;

export async function scanCompany(ctx: PluginContext, companyId: string, now: Date): Promise<StalledIssue[]> {
  const config = resolveConfig(await ctx.config.get());
  const stalled: StalledIssue[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await ctx.issues.list({ companyId, limit: PAGE_SIZE, offset });
    stalled.push(...findStalled(page, now, config));
    if (page.length < PAGE_SIZE) break;
  }
  return stalled.sort((a, b) => b.daysStalled - a.daysStalled || a.issueId.localeCompare(b.issueId));
}

export type StalledSnapshot = { scannedAt: string | null; stalled: StalledIssue[] };

/** Recorded after a nudge so the same stall is never nudged twice. */
type NudgeRecord = { nudgedAt: string; touchAfterNudge: string };

const nudgeKey = (issueId: string) => ({ scopeKind: "issue" as const, scopeId: issueId, stateKey: NUDGE_STATE_KEY });

/**
 * Posts one nudge comment per newly stalled issue, up to `maxNudgesPerRun`.
 * An issue is skipped while its last activity is no newer than the moment right
 * after our own nudge, so our comment never counts as fresh activity. Once
 * someone touches the issue and it stalls again, it is nudged again.
 */
export async function nudgeStalled(
  ctx: PluginContext,
  companyId: string,
  stalled: StalledIssue[],
  config: FinishLineConfig,
  now: Date,
): Promise<number> {
  if (!config.nudgeEnabled) return 0;
  let posted = 0;
  for (const row of stalled) {
    if (posted >= config.maxNudgesPerRun) break;
    const record = (await ctx.state.get(nudgeKey(row.issueId))) as NudgeRecord | null;
    if (record && new Date(row.lastTouchAt).getTime() <= new Date(record.touchAfterNudge).getTime()) continue;
    try {
      await ctx.issues.createComment(row.issueId, nudgeBody(row.daysStalled), companyId);
      const refreshed = await ctx.issues.get(row.issueId, companyId);
      const touch = refreshed ? lastTouchTime(refreshed) : null;
      await ctx.state.set(nudgeKey(row.issueId), {
        nudgedAt: now.toISOString(),
        touchAfterNudge: new Date(Math.max(touch ?? 0, now.getTime())).toISOString(),
      } satisfies NudgeRecord);
      posted += 1;
    } catch (err) {
      ctx.logger.warn("Finish Line nudge failed", {
        issueId: row.issueId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return posted;
}

const stalledKey = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: STALLED_STATE_KEY });

export async function readStalled(ctx: PluginContext, companyId: string): Promise<StalledSnapshot> {
  const stored = (await ctx.state.get(stalledKey(companyId))) as StalledSnapshot | null;
  return stored ?? { scannedAt: null, stalled: [] };
}

export async function scanAndStoreCompany(
  ctx: PluginContext,
  companyId: string,
  now: Date,
  options: { nudge?: boolean } = {},
): Promise<StalledSnapshot> {
  const snapshot = { scannedAt: now.toISOString(), stalled: await scanCompany(ctx, companyId, now) };
  await ctx.state.set(stalledKey(companyId), snapshot);
  if (options.nudge) {
    const config = resolveConfig(await ctx.config.get());
    await nudgeStalled(ctx, companyId, snapshot.stalled, config, now);
  }
  return snapshot;
}

export async function scanAllCompanies(ctx: PluginContext, now: Date): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const companies = await ctx.companies.list({ limit: PAGE_SIZE, offset });
    for (const company of companies) {
      const snapshot = await scanAndStoreCompany(ctx, company.id, now, { nudge: true });
      total += snapshot.stalled.length;
    }
    if (companies.length < PAGE_SIZE) break;
  }
  return total;
}
