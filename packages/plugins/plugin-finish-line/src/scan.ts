import type { PluginContext } from "@paperclipai/plugin-sdk";
import { findStalled, resolveConfig, type StalledIssue } from "./stale.js";

export const SCAN_JOB_KEY = "scan-stalled";
export const STALLED_STATE_KEY = "stalled";
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

export async function scanAllCompanies(ctx: PluginContext, now: Date): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const companies = await ctx.companies.list({ limit: PAGE_SIZE, offset });
    for (const company of companies) {
      const stalled = await scanCompany(ctx, company.id, now);
      await ctx.state.set(
        { scopeKind: "company", scopeId: company.id, stateKey: STALLED_STATE_KEY },
        { scannedAt: now.toISOString(), stalled },
      );
      total += stalled.length;
    }
    if (companies.length < PAGE_SIZE) break;
  }
  return total;
}
