import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { SCAN_JOB_KEY, scanAllCompanies } from "./scan.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.jobs.register(SCAN_JOB_KEY, async (job) => {
      const total = await scanAllCompanies(ctx, new Date());
      ctx.logger.info("Finish Line scan complete", { runId: job.runId, stalled: total });
    });

    ctx.data.register("health", async () => {
      return { status: "ok", checkedAt: new Date().toISOString() };
    });

    ctx.actions.register("ping", async () => {
      ctx.logger.info("Ping action invoked");
      return { pong: true, at: new Date().toISOString() };
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
