import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, evaluateIssue, findStalled, resolveConfig } from "../src/stale.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function issue(partial: Partial<Issue> & { id: string }): Issue {
  return {
    companyId: "co_1",
    title: `Issue ${partial.id}`,
    status: "in_progress",
    updatedAt: daysAgo(0),
    ...partial,
  } as unknown as Issue;
}

describe("resolveConfig", () => {
  it("uses defaults when config is empty", () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("accepts valid overrides and rejects invalid ones", () => {
    expect(resolveConfig({ staleDays: 10, nudgeEnabled: false, excludedStatuses: ["backlog"] })).toEqual({
      staleDays: 10,
      nudgeEnabled: false,
      excludedStatuses: ["backlog"],
    });
    expect(resolveConfig({ staleDays: 0, nudgeEnabled: "yes", excludedStatuses: "done" })).toEqual(DEFAULT_CONFIG);
  });
});

describe("evaluateIssue", () => {
  it("flags an issue at exactly staleDays", () => {
    const row = evaluateIssue(issue({ id: "a", updatedAt: daysAgo(5) }), NOW, DEFAULT_CONFIG);
    expect(row?.daysStalled).toBe(5);
  });

  it("ignores an issue one day short of staleDays", () => {
    expect(evaluateIssue(issue({ id: "a", updatedAt: daysAgo(4) }), NOW, DEFAULT_CONFIG)).toBeNull();
  });

  it("ignores excluded statuses", () => {
    expect(evaluateIssue(issue({ id: "a", status: "done", updatedAt: daysAgo(30) }), NOW, DEFAULT_CONFIG)).toBeNull();
    expect(evaluateIssue(issue({ id: "a", status: "cancelled", updatedAt: daysAgo(30) }), NOW, DEFAULT_CONFIG)).toBeNull();
  });

  it("uses lastActivityAt when it is newer than updatedAt", () => {
    const row = evaluateIssue(issue({ id: "a", updatedAt: daysAgo(20), lastActivityAt: daysAgo(1) }), NOW, DEFAULT_CONFIG);
    expect(row).toBeNull();
  });

  it("accepts ISO strings for dates", () => {
    const row = evaluateIssue(
      issue({ id: "a", updatedAt: daysAgo(8).toISOString() as unknown as Date }),
      NOW,
      DEFAULT_CONFIG,
    );
    expect(row?.daysStalled).toBe(8);
  });

  it("skips issues with no valid date", () => {
    expect(evaluateIssue(issue({ id: "a", updatedAt: "nope" as unknown as Date }), NOW, DEFAULT_CONFIG)).toBeNull();
  });
});

describe("findStalled", () => {
  it("returns stalled issues oldest first", () => {
    const rows = findStalled(
      [
        issue({ id: "a", updatedAt: daysAgo(6) }),
        issue({ id: "b", updatedAt: daysAgo(12) }),
        issue({ id: "c", updatedAt: daysAgo(1) }),
      ],
      NOW,
      DEFAULT_CONFIG,
    );
    expect(rows.map((r) => r.issueId)).toEqual(["b", "a"]);
  });
});
