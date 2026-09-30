import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Company, Issue } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000);
const company = (id: string) => ({ id, name: id }) as unknown as Company;
const issue = (id: string, companyId: string, days: number, status = "in_progress") =>
  ({ id, companyId, title: `Issue ${id}`, status, updatedAt: daysAgo(days) }) as unknown as Issue;

describe("finish line plugin", () => {
  it("declares capabilities for its manifest features", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["jobs.schedule", "companies.read", "issues.read", "ui.dashboardWidget.register"]),
    );
    expect(manifest.jobs?.map((job) => job.jobKey)).toContain("scan-stalled");
  });

  it("scan job stores stalled issues per company", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company("co_1"), company("co_2")],
      issues: [
        issue("i1", "co_1", 9),
        issue("i2", "co_1", 2),
        issue("i3", "co_1", 30, "done"),
        issue("i4", "co_2", 6),
      ],
    });

    await harness.runJob("scan-stalled");

    const one = harness.getState({ scopeKind: "company", scopeId: "co_1", stateKey: "stalled" }) as {
      stalled: { issueId: string; daysStalled: number }[];
    };
    expect(one.stalled.map((row) => row.issueId)).toEqual(["i1"]);
    expect(one.stalled[0]?.daysStalled).toBe(9);

    const two = harness.getState({ scopeKind: "company", scopeId: "co_2", stateKey: "stalled" }) as {
      stalled: { issueId: string }[];
    };
    expect(two.stalled.map((row) => row.issueId)).toEqual(["i4"]);
  });

  it("scan job honors staleDays config", async () => {
    const harness = createTestHarness({ manifest, config: { staleDays: 10 } });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [company("co_1")], issues: [issue("i1", "co_1", 9), issue("i2", "co_1", 11)] });

    await harness.runJob("scan-stalled");

    const state = harness.getState({ scopeKind: "company", scopeId: "co_1", stateKey: "stalled" }) as {
      stalled: { issueId: string }[];
    };
    expect(state.stalled.map((row) => row.issueId)).toEqual(["i2"]);
  });

  it("stalled data is empty before any scan", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    const data = await harness.getData<{ scannedAt: string | null; stalled: unknown[] }>("stalled", { companyId: "co_1" });
    expect(data).toEqual({ scannedAt: null, stalled: [] });
  });

  it("scan-now stores and returns stalled issues that the data handler then serves", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company("co_1")],
      issues: [issue("i1", "co_1", 9), issue("i2", "co_1", 20), issue("i3", "co_1", 1)],
    });

    const result = await harness.performAction<{ scannedAt: string; stalled: { issueId: string }[] }>("scan-now", {
      companyId: "co_1",
    });
    expect(result.stalled.map((row) => row.issueId)).toEqual(["i2", "i1"]);

    const data = await harness.getData<{ stalled: { issueId: string }[] }>("stalled", { companyId: "co_1" });
    expect(data.stalled.map((row) => row.issueId)).toEqual(["i2", "i1"]);
  });

  it("scan-now only scans the requested company", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company("co_1"), company("co_2")],
      issues: [issue("i1", "co_1", 9), issue("i2", "co_2", 9)],
    });

    await harness.performAction("scan-now", { companyId: "co_1" });

    const other = await harness.getData<{ scannedAt: string | null }>("stalled", { companyId: "co_2" });
    expect(other.scannedAt).toBeNull();
  });

  it("rejects data and actions without a companyId", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    await expect(harness.getData("stalled", {})).rejects.toThrow("companyId is required");
    await expect(harness.performAction("scan-now", {})).rejects.toThrow("companyId is required");
  });
});
