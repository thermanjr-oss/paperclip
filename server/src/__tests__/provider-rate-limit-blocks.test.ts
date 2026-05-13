import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  activityLog,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  issueRelations,
  providerRateLimitBlockMembers,
  providerRateLimitBlocks,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { providerRateLimitService } from "../services/provider-rate-limits.ts";

const mockFetchAllQuotaWindows = vi.hoisted(() => vi.fn());

vi.mock("../services/quota-windows.js", () => ({
  fetchAllQuotaWindows: mockFetchAllQuotaWindows,
}));

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres provider rate-limit block tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("provider rate-limit blocks", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-provider-rate-limit-blocks-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    mockFetchAllQuotaWindows.mockReset();
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(providerRateLimitBlockMembers);
    await db.delete(providerRateLimitBlocks);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedPausedClaudeAgentWithDueBlock(input?: {
    now?: Date;
    usedPercent?: number;
    adapterType?: string;
    limitKind?: string;
    provider?: string;
    extraWindows?: Array<Record<string, unknown>>;
  }) {
    const now = input?.now ?? new Date("2026-05-06T07:32:00.000Z");
    const companyId = randomUUID();
    const agentId = randomUUID();
    const blockId = randomUUID();
    const adapterType = input?.adapterType ?? "claude_local";
    const limitKind = input?.limitKind ?? "five_hour";
    const provider = input?.provider ?? "anthropic";

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "paused",
      pauseReason: "provider_rate_limit",
      pausedAt: new Date(now.getTime() - 60_000),
      adapterType,
      adapterConfig: adapterType === "claude_local"
        ? { model: "claude-sonnet-4-6" }
        : { model: "gpt-5.3-codex-spark" },
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
        },
      },
      permissions: {},
      lastHeartbeatAt: new Date(now.getTime() - 120_000),
    });

    await db.insert(providerRateLimitBlocks).values({
      id: blockId,
      companyId,
      adapterType,
      limitKind,
      modelFamily: null,
      resetsAt: new Date(now.getTime() - 1_000),
      message: "You've hit your limit - resets 9am",
    });

    mockFetchAllQuotaWindows.mockResolvedValue([
      {
        provider,
        ok: true,
        windows: [
          {
            label: limitKind,
            windowId: limitKind,
            usedPercent: input?.usedPercent ?? 100,
            resetsAt: null,
            valueLabel: null,
          },
          ...(input?.extraWindows ?? []),
        ],
      },
    ]);

    return { companyId, agentId, blockId, now };
  }

  it("keeps a reset-due block active when provider quota still appears exhausted", async () => {
    const { companyId, agentId, blockId, now } = await seedPausedClaudeAgentWithDueBlock({
      usedPercent: 100,
    });

    await heartbeat.tickTimers(now);

    const [block] = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeNull();

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("paused");
    expect(agent?.pauseReason).toBe("provider_rate_limit");

    const resetWakeups = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.agentId, agentId), eq(agentWakeupRequests.reason, "provider_rate_limit_reset")));
    expect(resetWakeups).toHaveLength(0);

    const activeBlocks = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(
        and(
          eq(providerRateLimitBlocks.companyId, companyId),
          isNull(providerRateLimitBlocks.resolvedAt),
        ),
      );
    expect(activeBlocks).toHaveLength(1);
  });

  it("queues one provider reset wakeup for the current issue assignee", async () => {
    const svc = providerRateLimitService(db);
    const now = new Date("2026-05-06T12:40:00.000Z");
    const companyId = randomUUID();
    const assigneeAgentId = randomUUID();
    const staleAgentId = randomUUID();
    const issueId = randomUUID();
    const blockId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: assigneeAgentId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "paused",
        pauseReason: "provider_rate_limit",
        pausedAt: new Date(now.getTime() - 60_000),
        adapterType: "claude_local",
        adapterConfig: { model: "claude-sonnet-4-6" },
        runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
        permissions: {},
      },
      {
        id: staleAgentId,
        companyId,
        name: "CMO",
        role: "cmo",
        status: "paused",
        pauseReason: "provider_rate_limit",
        pausedAt: new Date(now.getTime() - 60_000),
        adapterType: "claude_local",
        adapterConfig: { model: "claude-sonnet-4-6" },
        runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
        permissions: {},
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Continue after provider reset",
      status: "blocked",
      assigneeAgentId,
    });

    const [block] = await db
      .insert(providerRateLimitBlocks)
      .values({
        id: blockId,
        companyId,
        adapterType: "claude_local",
        limitKind: "five_hour",
        modelFamily: null,
        resetsAt: new Date(now.getTime() - 1_000),
        resolvedAt: now,
        resolvedBy: "test",
        message: "You've hit your limit - resets 2:40pm",
      })
      .returning();

    await db.insert(providerRateLimitBlockMembers).values([
      {
        blockId,
        companyId,
        agentId: staleAgentId,
        issueId,
        releaseStatus: "pending",
        updatedAt: now,
      },
      {
        blockId,
        companyId,
        agentId: assigneeAgentId,
        issueId,
        releaseStatus: "pending",
        updatedAt: now,
      },
    ]);

    const release = await svc.releaseAndResumeForBlock(block!);
    expect(release.wakeupsQueued).toBe(1);

    const wakeups = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.reason, "provider_rate_limit_reset"));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.agentId).toBe(assigneeAgentId);
    expect(wakeups[0]?.idempotencyKey).toBe(`provider_rate_limit_reset:${blockId}:${issueId}:${assigneeAgentId}`);

    const staleMember = await db
      .select()
      .from(providerRateLimitBlockMembers)
      .where(and(eq(providerRateLimitBlockMembers.blockId, blockId), eq(providerRateLimitBlockMembers.agentId, staleAgentId)))
      .then((rows) => rows[0] ?? null);
    expect(staleMember?.releaseReason).toBe("issue_assignee_mismatch");

    const assigneeMember = await db
      .select()
      .from(providerRateLimitBlockMembers)
      .where(and(eq(providerRateLimitBlockMembers.blockId, blockId), eq(providerRateLimitBlockMembers.agentId, assigneeAgentId)))
      .then((rows) => rows[0] ?? null);
    expect(assigneeMember?.wakeupRequestId).toBe(wakeups[0]?.id);
  });

  it("skips provider reset wakeup when issue dependencies are unresolved", async () => {
    const svc = providerRateLimitService(db);
    const now = new Date("2026-05-06T12:40:00.000Z");
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const blockerIssueId = randomUUID();
    const blockId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "cto",
      status: "paused",
      pauseReason: "provider_rate_limit",
      pausedAt: new Date(now.getTime() - 60_000),
      adapterType: "claude_local",
      adapterConfig: { model: "claude-sonnet-4-6" },
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
      permissions: {},
    });

    await db.insert(issues).values([
      {
        id: blockerIssueId,
        companyId,
        title: "Approval gate",
        status: "blocked",
      },
      {
        id: issueId,
        companyId,
        title: "Continue after provider reset",
        status: "blocked",
        assigneeAgentId: agentId,
      },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerIssueId,
      relatedIssueId: issueId,
      type: "blocks",
    });

    const [block] = await db
      .insert(providerRateLimitBlocks)
      .values({
        id: blockId,
        companyId,
        adapterType: "claude_local",
        limitKind: "five_hour",
        modelFamily: null,
        resetsAt: new Date(now.getTime() - 1_000),
        resolvedAt: now,
        resolvedBy: "test",
      })
      .returning();

    await db.insert(providerRateLimitBlockMembers).values({
      blockId,
      companyId,
      agentId,
      issueId,
      releaseStatus: "pending",
      updatedAt: now,
    });

    const release = await svc.releaseAndResumeForBlock(block!);
    expect(release.wakeupsQueued).toBe(0);
    expect(release.wakeupsSkipped).toBe(1);

    const wakeups = await db.select().from(agentWakeupRequests);
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.status).toBe("skipped");
    expect(wakeups[0]?.reason).toBe("issue_dependencies_blocked");
    expect(wakeups[0]?.payload).toMatchObject({
      issueId,
      unresolvedBlockerIssueIds: [blockerIssueId],
    });

    const runs = await db.select().from(heartbeatRuns);
    expect(runs).toHaveLength(0);
  });

  it("coalesces repeated hits into the same active block without moving createdAt", async () => {
    const svc = providerRateLimitService(db);
    const companyId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const firstReset = new Date("2026-05-06T07:00:00.000Z");
    const first = await svc.upsertBlock({
      companyId,
      adapterType: "claude_local",
      limitKind: "five_hour",
      modelFamily: "claude-sonnet",
      message: "first hit",
      resetsAt: firstReset,
    });
    const createdAt = first.createdAt;

    for (let i = 0; i < 9; i += 1) {
      await svc.upsertBlock({
        companyId,
        adapterType: "claude_local",
        limitKind: "five_hour",
        modelFamily: "claude-sonnet",
        message: `hit ${i + 2}`,
        resetsAt: new Date(firstReset.getTime() + (i + 1) * 60_000),
      });
    }

    const blocks = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(and(eq(providerRateLimitBlocks.companyId, companyId), isNull(providerRateLimitBlocks.resolvedAt)));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe(first.id);
    expect(blocks[0]?.hitCount).toBe(10);
    expect(blocks[0]?.createdAt.getTime()).toBe(createdAt.getTime());
    expect(blocks[0]?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
    expect(blocks[0]?.message).toBe("hit 10");
  });

  it("resolves and resumes only after the provider quota probe reports capacity", async () => {
    const { agentId, blockId, now } = await seedPausedClaudeAgentWithDueBlock({
      usedPercent: 0,
    });

    await heartbeat.tickTimers(now);

    const [block] = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeInstanceOf(Date);
    expect(block?.resolvedBy).toBe("system");

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("idle");
    expect(agent?.pauseReason).toBeNull();
    expect(agent?.pausedAt).toBeNull();
  });

  it("resolves a Claude weekly block when extra usage still has capacity", async () => {
    const { agentId, blockId, now } = await seedPausedClaudeAgentWithDueBlock({
      limitKind: "seven_day",
      usedPercent: 100,
      extraWindows: [
        {
          label: "Extra usage",
          windowId: "extra_usage",
          usedPercent: 20,
          resetsAt: null,
          valueLabel: "$2.00 / $10.00",
          detail: "Monthly extra usage pool",
        },
      ],
    });

    await heartbeat.tickTimers(now);

    const [block] = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeInstanceOf(Date);

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("idle");
    expect(agent?.pauseReason).toBeNull();
  });

  it("keeps a reset-due Claude block active when extra usage is disabled and quota is exhausted", async () => {
    const { agentId, blockId, now } = await seedPausedClaudeAgentWithDueBlock({
      limitKind: "seven_day",
      usedPercent: 100,
      extraWindows: [
        {
          label: "Extra usage",
          windowId: "extra_usage",
          usedPercent: null,
          resetsAt: null,
          valueLabel: "Not enabled",
          detail: "Extra usage not enabled",
        },
      ],
    });

    await heartbeat.tickTimers(now);

    const [block] = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeNull();

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("paused");
    expect(agent?.pauseReason).toBe("provider_rate_limit");
  });

  it("resolves a Codex weekly block when paid credits remain", async () => {
    const { agentId, blockId, now } = await seedPausedClaudeAgentWithDueBlock({
      adapterType: "codex_local",
      provider: "openai",
      limitKind: "weekly",
      usedPercent: 100,
      extraWindows: [
        {
          label: "Credits",
          windowId: "credits",
          usedPercent: null,
          resetsAt: null,
          valueLabel: "$4.20 remaining",
          detail: null,
        },
      ],
    });

    await heartbeat.tickTimers(now);

    const [block] = await db
      .select()
      .from(providerRateLimitBlocks)
      .where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeInstanceOf(Date);

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("idle");
    expect(agent?.pauseReason).toBeNull();
  });

  it("does not unblock unrelated issues when a released block has no members or matching agents", async () => {
    const svc = providerRateLimitService(db);
    const now = new Date("2026-05-06T07:32:00.000Z");
    const companyId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const [block] = await db
      .insert(providerRateLimitBlocks)
      .values({
        companyId,
        adapterType: "claude_local",
        limitKind: "five_hour",
        modelFamily: null,
        resetsAt: new Date(now.getTime() - 1_000),
        createdAt: new Date(now.getTime() - 60_000),
        updatedAt: now,
      })
      .returning();

    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Continue after provider reset",
      status: "blocked",
      updatedAt: now,
    });

    await svc.releaseAndResumeForBlock(block!);

    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("blocked");
  });

  it("releases only a changed-scope provider pause and keeps the original provider block active", async () => {
    const svc = providerRateLimitService(db);
    const now = new Date("2026-05-06T08:00:00.000Z");
    const companyId = randomUUID();
    const releasedAgentId = randomUUID();
    const stillBlockedAgentId = randomUUID();
    const issueId = randomUUID();
    const blockId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: releasedAgentId,
        companyId,
        name: "Codex",
        role: "engineer",
        status: "paused",
        pauseReason: "provider_rate_limit",
        pausedAt: new Date(now.getTime() - 60_000),
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5.3-codex" },
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: stillBlockedAgentId,
        companyId,
        name: "Claude",
        role: "engineer",
        status: "paused",
        pauseReason: "provider_rate_limit",
        pausedAt: new Date(now.getTime() - 60_000),
        adapterType: "claude_local",
        adapterConfig: { model: "claude-opus-4-7" },
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Continue after switching provider",
      status: "blocked",
      assigneeAgentId: releasedAgentId,
      updatedAt: now,
    });
    await db.insert(providerRateLimitBlocks).values({
      id: blockId,
      companyId,
      adapterType: "claude_local",
      limitKind: "seven_day_opus",
      modelFamily: "claude-opus",
      message: "Opus quota exhausted",
    });
    await db.insert(providerRateLimitBlockMembers).values([
      {
        blockId,
        companyId,
        agentId: releasedAgentId,
        issueId,
        originalAgentStatus: "running",
        releaseStatus: "pending",
      },
      {
        blockId,
        companyId,
        agentId: stillBlockedAgentId,
        originalAgentStatus: "running",
        releaseStatus: "pending",
      },
    ]);

    const result = await svc.reconcileAgentProviderLimitPause(releasedAgentId);

    expect(result).toMatchObject({ released: true, issueIds: [issueId], wakeupsQueued: 1 });
    const [block] = await db.select().from(providerRateLimitBlocks).where(eq(providerRateLimitBlocks.id, blockId));
    expect(block?.resolvedAt).toBeNull();
    const [releasedAgent] = await db.select().from(agents).where(eq(agents.id, releasedAgentId));
    expect(releasedAgent?.status).toBe("idle");
    expect(releasedAgent?.pauseReason).toBeNull();
    const [stillBlockedAgent] = await db.select().from(agents).where(eq(agents.id, stillBlockedAgentId));
    expect(stillBlockedAgent?.status).toBe("paused");
    expect(stillBlockedAgent?.pauseReason).toBe("provider_rate_limit");
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("in_progress");
    const wakeups = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.agentId, releasedAgentId), eq(agentWakeupRequests.reason, "provider_rate_limit_scope_changed")));
    expect(wakeups).toHaveLength(1);
  });

  it("uses the issue model profile when reconciling model-family provider pauses", async () => {
    const svc = providerRateLimitService(db);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const blockId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Claude",
      role: "engineer",
      status: "paused",
      pauseReason: "provider_rate_limit",
      pausedAt: new Date(),
      adapterType: "claude_local",
      adapterConfig: { model: "claude-opus-4-7" },
      runtimeConfig: {
        modelProfiles: {
          cheap: { adapterConfig: { model: "claude-sonnet-4-6" } },
        },
      },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Cheap lane",
      status: "blocked",
      assigneeAgentId: agentId,
      assigneeAdapterOverrides: { modelProfile: "cheap" },
    });
    await db.insert(providerRateLimitBlocks).values({
      id: blockId,
      companyId,
      adapterType: "claude_local",
      limitKind: "seven_day_opus",
      modelFamily: "claude-opus",
      message: "Opus quota exhausted",
    });
    await db.insert(providerRateLimitBlockMembers).values({
      blockId,
      companyId,
      agentId,
      issueId,
      originalAgentStatus: "running",
      releaseStatus: "pending",
    });

    const result = await svc.reconcileAgentProviderLimitPause(agentId);

    expect(result.released).toBe(true);
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("idle");
    const effectiveModel = await svc.resolveEffectiveRunModel({ companyId, agent: agent!, issueId });
    expect(effectiveModel).toBe("claude-sonnet-4-6");
    await expect(svc.getActiveBlockForAgent(companyId, "claude_local", effectiveModel)).resolves.toBeNull();
  });

  it("keeps Sonnet paused under a generic Claude provider block and never crosses providers", async () => {
    const svc = providerRateLimitService(db);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const blockId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Claude",
      role: "engineer",
      status: "paused",
      pauseReason: "provider_rate_limit",
      pausedAt: new Date(),
      adapterType: "claude_local",
      adapterConfig: { model: "claude-sonnet-4-6" },
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Generic Claude lane",
      status: "blocked",
      assigneeAgentId: agentId,
    });
    await db.insert(providerRateLimitBlocks).values({
      id: blockId,
      companyId,
      adapterType: "claude_local",
      limitKind: "five_hour",
      modelFamily: null,
      message: "Claude quota exhausted",
    });
    await db.insert(providerRateLimitBlockMembers).values({
      blockId,
      companyId,
      agentId,
      issueId,
      originalAgentStatus: "running",
      releaseStatus: "pending",
    });

    await expect(svc.reconcileAgentProviderLimitPause(agentId))
      .resolves.toMatchObject({ released: false, issueIds: [] });
    await expect(svc.getActiveBlockForAgent(companyId, "codex_local", "gpt-5.3-codex"))
      .resolves.toBeNull();
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.status).toBe("paused");
    expect(agent?.pauseReason).toBe("provider_rate_limit");
  });
});
