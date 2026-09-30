import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "thermanjr.plugin-finish-line",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Finish Line",
  description: "Finds stalled issues, shows them on the dashboard, and nudges once per stall.",
  author: "thermanjr",
  categories: ["automation"],
  capabilities: [
    "jobs.schedule",
    "companies.read",
    "issues.read",
    "issue.comments.create",
    "plugin.state.read",
    "plugin.state.write",
    "ui.dashboardWidget.register"
  ],
  jobs: [
    {
      jobKey: "scan-stalled",
      displayName: "Scan for stalled issues",
      description: "Finds open issues with no activity for staleDays and stores them for the dashboard.",
      schedule: "0 9 * * *"
    }
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      staleDays: { type: "number", minimum: 1, default: 5, description: "Days without activity before an issue counts as stalled." },
      nudgeEnabled: { type: "boolean", default: true, description: "Post one nudge comment per stalled issue." },
      maxNudgesPerRun: { type: "number", minimum: 0, default: 20, description: "Most nudge comments posted per company in one daily run." },
      excludedStatuses: { type: "array", items: { type: "string" }, default: ["done", "cancelled"], description: "Issue statuses to ignore." }
    }
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: "Finish Line Health",
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;
