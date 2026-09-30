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
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "ui.dashboardWidget.register"
  ],
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
