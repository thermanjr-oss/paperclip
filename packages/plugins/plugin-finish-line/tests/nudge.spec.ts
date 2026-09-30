import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Company, Issue } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { nudgeStalled } from "../src/scan.js";
import { DEFAULT_CONFIG, nudgeBody, type StalledIssue } from "../src/stale.js";

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000);
const company = (id: string) => ({ id, name: id }) as unknown as Company;
const issue = (id: string, days: number, status = "in_progress") =>
  ({ id, companyId: "co_1", title: `Issue ${id}`, status, updatedAt: daysAgo(days) }) as unknown as Issue;

async function setup(config?: Record<string, unknown>) {
  const harness = createTestHarness({
    manifest,
    capabilities: [...manifest.capabilities, "issue.comments.read"],
    config,
  });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const comments = (harness: Awaited<ReturnType<typeof setup>>, issueId: string) =>
  harness.ctx.issues.listComments(issueId, "co_1");

describe("nudges", () => {
  it("posts one nudge per stalled issue and none for fresh or finished issues", async () => {
    const harness = await setup();
    harness.seed({
      companies: [company("co_1")],
      issues: [issue("stale", 9), issue("fresh", 1), issue("finished", 30, "done")],
    });

    await harness.runJob("scan-stalled");

    const stale = await comments(harness, "stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.body).toBe(nudgeBody(9));
    expect(await comments(harness, "fresh")).toHaveLength(0);
    expect(await comments(harness, "finished")).toHaveLength(0);
  });

  it("does not nudge the same stall twice", async () => {
    const harness = await setup();
    harness.seed({ companies: [company("co_1")], issues: [issue("stale", 9)] });

    await harness.runJob("scan-stalled");
    await harness.runJob("scan-stalled");

    expect(await comments(harness, "stale")).toHaveLength(1);
  });

  it("posts nothing when nudgeEnabled is false", async () => {
    const harness = await setup({ nudgeEnabled: false });
    harness.seed({ companies: [company("co_1")], issues: [issue("stale", 9)] });

    await harness.runJob("scan-stalled");

    expect(await comments(harness, "stale")).toHaveLength(0);
  });

  it("caps nudges per run and finishes the rest on the next run", async () => {
    const harness = await setup({ maxNudgesPerRun: 2 });
    harness.seed({ companies: [company("co_1")], issues: [issue("a", 12), issue("b", 10), issue("c", 8)] });

    await harness.runJob("scan-stalled");
    const afterFirst = (await Promise.all(["a", "b", "c"].map((id) => comments(harness, id)))).map((c) => c.length);
    expect(afterFirst).toEqual([1, 1, 0]);

    await harness.runJob("scan-stalled");
    const afterSecond = (await Promise.all(["a", "b", "c"].map((id) => comments(harness, id)))).map((c) => c.length);
    expect(afterSecond).toEqual([1, 1, 1]);
  });

  it("Scan now shows stalled issues but never posts comments", async () => {
    const harness = await setup();
    harness.seed({ companies: [company("co_1")], issues: [issue("stale", 9)] });

    const result = await harness.performAction<{ stalled: unknown[] }>("scan-now", { companyId: "co_1" });

    expect(result.stalled).toHaveLength(1);
    expect(await comments(harness, "stale")).toHaveLength(0);
  });

  it("nudges again after new activity followed by a new stall, but not while inactive since the nudge", async () => {
    const harness = await setup();
    const first = new Date("2026-10-10T12:00:00Z");
    const row = (lastTouchAt: string): StalledIssue => ({
      issueId: "stale",
      companyId: "co_1",
      title: "Issue stale",
      status: "in_progress",
      lastTouchAt,
      daysStalled: 6,
    });
    harness.seed({
      companies: [company("co_1")],
      issues: [{ ...issue("stale", 0), updatedAt: new Date("2026-10-01T00:00:00Z") } as Issue],
    });

    expect(await nudgeStalled(harness.ctx, "co_1", [row("2026-10-01T00:00:00Z")], DEFAULT_CONFIG, first)).toBe(1);
    // Same last activity as before the nudge: still the same stall.
    expect(await nudgeStalled(harness.ctx, "co_1", [row("2026-10-01T00:00:00Z")], DEFAULT_CONFIG, first)).toBe(0);
    // Activity after the nudge, then stalled again: a new stall.
    const later = new Date("2026-10-20T12:00:00Z");
    expect(await nudgeStalled(harness.ctx, "co_1", [row("2026-10-12T00:00:00Z")], DEFAULT_CONFIG, later)).toBe(1);
    expect(await comments(harness, "stale")).toHaveLength(2);
  });
});
