import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, providerRateLimitBlocks } from "@paperclipai/db";
import { fetchAllQuotaWindows } from "./quota-windows.js";
import type { ProviderQuotaResult, QuotaWindow } from "@paperclipai/shared";

function providerSlugForAdapterType(adapterType: string): string {
  if (adapterType === "claude_local") return "anthropic";
  if (adapterType === "codex_local") return "openai";
  return adapterType;
}

function hasPositiveMoneyValue(label: string | null | undefined): boolean {
  if (!label) return false;
  const match = label.match(/(?:\$|€|£)?\s*(\d+(?:\.\d+)?)/);
  if (!match) return false;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0;
}

function windowShowsUsablePaidOverflow(window: QuotaWindow): boolean {
  const windowId = window.windowId?.toLowerCase() ?? "";
  const label = window.label.toLowerCase();
  const valueLabel = window.valueLabel?.toLowerCase() ?? "";
  const detail = window.detail?.toLowerCase() ?? "";

  if (windowId === "extra_usage" || label.includes("extra usage")) {
    if (valueLabel.includes("not enabled") || detail.includes("not enabled")) return false;
    if (window.usedPercent == null) return hasPositiveMoneyValue(window.valueLabel);
    return window.usedPercent < 100;
  }

  if (windowId === "credits" || label.includes("credits")) {
    if (valueLabel.includes("n/a") || valueLabel.includes("not enabled")) return false;
    return hasPositiveMoneyValue(window.valueLabel);
  }

  return false;
}

function providerHasUsablePaidOverflow(providerResult: ProviderQuotaResult): boolean {
  return providerResult.windows.some(windowShowsUsablePaidOverflow);
}

export function providerRateLimitService(db: Db) {
  async function upsertBlock(input: {
    companyId: string;
    adapterType: string;
    limitKind: string;
    modelFamily: string | null;
    message: string | null;
    resetsAt: Date | null;
  }) {
    const now = new Date();
    // Resolve any existing active block for this scope before creating a new one.
    await db
      .update(providerRateLimitBlocks)
      .set({ resolvedAt: now, resolvedBy: "system", updatedAt: now })
      .where(
        and(
          eq(providerRateLimitBlocks.companyId, input.companyId),
          eq(providerRateLimitBlocks.adapterType, input.adapterType),
          eq(providerRateLimitBlocks.limitKind, input.limitKind),
          input.modelFamily
            ? eq(providerRateLimitBlocks.modelFamily, input.modelFamily)
            : isNull(providerRateLimitBlocks.modelFamily),
          isNull(providerRateLimitBlocks.resolvedAt),
        ),
      );

    const [block] = await db
      .insert(providerRateLimitBlocks)
      .values({
        companyId: input.companyId,
        adapterType: input.adapterType,
        limitKind: input.limitKind,
        modelFamily: input.modelFamily,
        message: input.message,
        resetsAt: input.resetsAt,
        updatedAt: now,
      })
      .returning();
    return block!;
  }

  async function getActiveBlockForAgent(
    companyId: string,
    adapterType: string,
    model: string | null,
  ) {
    const blocks = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(
        and(
          eq(providerRateLimitBlocks.companyId, companyId),
          eq(providerRateLimitBlocks.adapterType, adapterType),
          isNull(providerRateLimitBlocks.resolvedAt),
        ),
      );

    // A block matches if modelFamily is null (global) or if the agent's model starts with modelFamily.
    for (const block of blocks) {
      if (!block.modelFamily) return block;
      if (model && model.toLowerCase().startsWith(block.modelFamily.toLowerCase())) return block;
    }
    return null;
  }

  async function listActiveBlocks(companyId: string) {
    return db
      .select()
      .from(providerRateLimitBlocks)
      .where(
        and(
          eq(providerRateLimitBlocks.companyId, companyId),
          isNull(providerRateLimitBlocks.resolvedAt),
        ),
      );
  }

  async function getBlock(blockId: string) {
    return db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId))
      .then((rows) => rows[0] ?? null);
  }

  async function listResetDueActiveBlocks(now: Date) {
    return db
      .select()
      .from(providerRateLimitBlocks)
      .where(
        and(
          isNull(providerRateLimitBlocks.resolvedAt),
          lte(providerRateLimitBlocks.resetsAt, now),
        ),
      );
  }

  async function resolveBlock(blockId: string, resolvedBy: string) {
    const now = new Date();
    const [block] = await db
      .update(providerRateLimitBlocks)
      .set({ resolvedAt: now, resolvedBy, updatedAt: now })
      .where(
        and(
          eq(providerRateLimitBlocks.id, blockId),
          isNull(providerRateLimitBlocks.resolvedAt),
        ),
      )
      .returning();
    return block ?? null;
  }

  async function pauseAgentsForBlock(
    companyId: string,
    adapterType: string,
    modelFamily: string | null,
  ) {
    const now = new Date();
    const baseFilter = and(
      eq(agents.companyId, companyId),
      eq(agents.adapterType, adapterType),
      inArray(agents.status, ["active", "idle", "running", "error"]),
    );

    const filter = modelFamily
      ? and(
          baseFilter,
          sql`lower(${agents.adapterConfig}->>'model') LIKE lower(${modelFamily + "%"})`,
        )
      : baseFilter;

    return db
      .update(agents)
      .set({ status: "paused", pauseReason: "provider_rate_limit", pausedAt: now, updatedAt: now })
      .where(filter)
      .returning();
  }

  async function resumeAgentsForBlock(
    companyId: string,
    adapterType: string,
    modelFamily: string | null,
  ) {
    const now = new Date();
    const baseFilter = and(
      eq(agents.companyId, companyId),
      eq(agents.adapterType, adapterType),
      eq(agents.status, "paused"),
      eq(agents.pauseReason, "provider_rate_limit"),
    );

    const filter = modelFamily
      ? and(
          baseFilter,
          sql`lower(${agents.adapterConfig}->>'model') LIKE lower(${modelFamily + "%"})`,
        )
      : baseFilter;

    return db
      .update(agents)
      .set({ status: "idle", pauseReason: null, pausedAt: null, updatedAt: now })
      .where(filter)
      .returning();
  }

  async function listAgentIdsForBlockScope(
    companyId: string,
    adapterType: string,
    modelFamily: string | null,
  ) {
    const baseFilter = and(
      eq(agents.companyId, companyId),
      eq(agents.adapterType, adapterType),
    );

    const filter = modelFamily
      ? and(
          baseFilter,
          sql`lower(${agents.adapterConfig}->>'model') LIKE lower(${modelFamily + "%"})`,
        )
      : baseFilter;

    return db
      .select({ id: agents.id })
      .from(agents)
      .where(filter)
      .then((rows) => rows.map((row) => row.id));
  }

  async function isWindowStillBlocked(adapterType: string, limitKind: string): Promise<boolean> {
    try {
      const results = await fetchAllQuotaWindows();
      const providerSlug = providerSlugForAdapterType(adapterType);
      const providerResult = results.find((r) => r.provider === providerSlug);
      if (!providerResult?.ok) return true; // Cannot verify → assume still blocked
      const window = providerResult.windows.find((w) => w.windowId === limitKind);
      if (!window) return false; // Window no longer reported → assume released
      if ((window.usedPercent ?? 0) < 100) return false;
      return !providerHasUsablePaidOverflow(providerResult);
    } catch {
      return true; // Quota probe failed → assume still blocked
    }
  }

  async function releaseAndResumeForBlock(
    block: typeof providerRateLimitBlocks.$inferSelect,
  ) {
    const [resumedAgents, scopedAgentIds] = await Promise.all([
      resumeAgentsForBlock(
        block.companyId,
        block.adapterType,
        block.modelFamily,
      ),
      listAgentIdsForBlockScope(
        block.companyId,
        block.adapterType,
        block.modelFamily,
      ),
    ]);

    const agentIds = [...new Set([...scopedAgentIds, ...resumedAgents.map((a) => a.id)])];
    const now = new Date();
    const assigneeScope = agentIds.length > 0
      ? inArray(issues.assigneeAgentId, agentIds)
      : undefined;
    // Unblock issues that were blocked after the rate limit started. When matching
    // agents no longer exist, fall back to the time/company scope so release still
    // clears issue state instead of leaving work blocked forever.
    await db
      .update(issues)
      .set({ status: "in_progress", updatedAt: now })
      .where(
        and(
          eq(issues.companyId, block.companyId),
          eq(issues.status, "blocked"),
          assigneeScope,
          // Only unblock issues that became blocked after the rate limit was created.
          or(isNull(issues.updatedAt), gte(issues.updatedAt, block.createdAt)),
        ),
      );
  }

  async function deriveBlockScope(
    adapterType: string,
    rateLimitBlock: { limitKind: string; modelFamily: string | null; resetsAt: string | null },
  ): Promise<{ limitKind: string; modelFamily: string | null; resetsAt: Date | null }> {
    let { limitKind, modelFamily } = rateLimitBlock;
    const resetsAt = rateLimitBlock.resetsAt ? new Date(rateLimitBlock.resetsAt) : null;

    // For generic limits, probe quota windows to find the exhausted one.
    if (limitKind === "generic") {
      try {
        const results = await fetchAllQuotaWindows();
        const providerSlug = providerSlugForAdapterType(adapterType);
        const providerResult = results.find((r) => r.provider === providerSlug && r.ok);
        if (providerResult) {
          const exhausted = providerResult.windows.find(
            (w) => w.windowId && (w.usedPercent ?? 0) >= 100 && !windowShowsUsablePaidOverflow(w),
          );
          if (exhausted?.windowId) {
            limitKind = exhausted.windowId;
            // Derive modelFamily from windowId
            if (limitKind === "seven_day_opus") modelFamily = "claude-opus";
            else if (limitKind === "seven_day_sonnet") modelFamily = "claude-sonnet";
            else modelFamily = null;
          }
        }
      } catch {
        // Fall through with generic
      }
    }

    return { limitKind, modelFamily, resetsAt };
  }

  return {
    upsertBlock,
    getBlock,
    getActiveBlockForAgent,
    listActiveBlocks,
    listResetDueActiveBlocks,
    resolveBlock,
    pauseAgentsForBlock,
    resumeAgentsForBlock,
    isWindowStillBlocked,
    releaseAndResumeForBlock,
    deriveBlockScope,
  };
}

export type ProviderRateLimitService = ReturnType<typeof providerRateLimitService>;
