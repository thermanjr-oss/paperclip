import type { Issue } from "@paperclipai/plugin-sdk";

export type FinishLineConfig = {
  staleDays: number;
  nudgeEnabled: boolean;
  excludedStatuses: string[];
  maxNudgesPerRun: number;
};

export const DEFAULT_CONFIG: FinishLineConfig = {
  staleDays: 5,
  nudgeEnabled: true,
  excludedStatuses: ["done", "cancelled"],
  maxNudgesPerRun: 20,
};

export type StalledIssue = {
  issueId: string;
  companyId: string;
  title: string;
  status: string;
  lastTouchAt: string;
  daysStalled: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveConfig(raw: Record<string, unknown> | null | undefined): FinishLineConfig {
  const staleDays = typeof raw?.staleDays === "number" && raw.staleDays >= 1 ? raw.staleDays : DEFAULT_CONFIG.staleDays;
  const nudgeEnabled = typeof raw?.nudgeEnabled === "boolean" ? raw.nudgeEnabled : DEFAULT_CONFIG.nudgeEnabled;
  const excludedStatuses = Array.isArray(raw?.excludedStatuses)
    ? raw.excludedStatuses.filter((s): s is string => typeof s === "string")
    : DEFAULT_CONFIG.excludedStatuses;
  const maxNudgesPerRun =
    typeof raw?.maxNudgesPerRun === "number" && raw.maxNudgesPerRun >= 0
      ? Math.floor(raw.maxNudgesPerRun)
      : DEFAULT_CONFIG.maxNudgesPerRun;
  return { staleDays, nudgeEnabled, excludedStatuses, maxNudgesPerRun };
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Latest of `updatedAt` and `lastActivityAt`, or null when neither is a valid date. */
export function lastTouchTime(issue: Pick<Issue, "updatedAt" | "lastActivityAt">): number | null {
  const times = [toTime(issue.updatedAt), toTime(issue.lastActivityAt)].filter((t): t is number => t !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

/** Returns the stall details for one issue, or null when it is not stalled. */
export function evaluateIssue(issue: Issue, now: Date, config: FinishLineConfig): StalledIssue | null {
  if (config.excludedStatuses.includes(issue.status)) return null;
  const touched = lastTouchTime(issue);
  if (touched === null) return null;
  const daysStalled = Math.floor((now.getTime() - touched) / DAY_MS);
  if (daysStalled < config.staleDays) return null;
  return {
    issueId: issue.id,
    companyId: issue.companyId,
    title: issue.title,
    status: issue.status,
    lastTouchAt: new Date(touched).toISOString(),
    daysStalled,
  };
}

/** Stalled issues, oldest first. */
export function findStalled(issues: Issue[], now: Date, config: FinishLineConfig): StalledIssue[] {
  return issues
    .map((issue) => evaluateIssue(issue, now, config))
    .filter((row): row is StalledIssue => row !== null)
    .sort((a, b) => b.daysStalled - a.daysStalled || a.issueId.localeCompare(b.issueId));
}

export function nudgeBody(daysStalled: number): string {
  return `No activity on this issue for ${daysStalled} days. Is it blocked, or ready to move?`;
}
