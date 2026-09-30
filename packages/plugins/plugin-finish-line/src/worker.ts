import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { SCAN_JOB_KEY, readStalled, scanAllCompanies, scanAndStoreCompany } from "./scan.js";

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = params.companyId;
  if (typeof companyId !== "string" || companyId.length === 0) throw new Error("companyId is required");
  return companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.jobs.register(SCAN_JOB_KEY, async (job) => {
      const total = await scanAllCompanies(ctx, new Date());
      ctx.logger.info("Finish Line scan complete", { runId: job.runId, stalled: total });
    });

    ctx.data.register("stalled", async (params) => readStalled(ctx, requireCompanyId(params)));

    ctx.actions.register("scan-now", async (params) => scanAndStoreCompany(ctx, requireCompanyId(params), new Date()));
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
