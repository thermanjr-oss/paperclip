import { useState } from "react";
import { usePluginAction, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type StalledIssue = {
  issueId: string;
  title: string;
  status: string;
  lastTouchAt: string;
  daysStalled: number;
};

type StalledSnapshot = {
  scannedAt: string | null;
  stalled: StalledIssue[];
};

export function DashboardWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId;
  const { data, loading, error, refresh } = usePluginData<StalledSnapshot>("stalled", { companyId });
  const scanNow = usePluginAction("scan-now");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  if (!companyId) return <div>Select a company to see stalled work.</div>;

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    try {
      await scanNow({ companyId });
      refresh();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <strong>Stalled work</strong>
        <button onClick={() => void handleScan()} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan now"}
        </button>
      </div>
      {scanError ? <div role="alert">Scan error: {scanError}</div> : null}
      {loading ? <div>Loading...</div> : null}
      {error ? <div role="alert">Plugin error: {error.message}</div> : null}
      {data && data.scannedAt === null ? <div>Not scanned yet. Press Scan now.</div> : null}
      {data && data.scannedAt !== null ? (
        <>
          <div style={{ opacity: 0.7, fontSize: "0.85em" }}>
            Last scan: {new Date(data.scannedAt).toLocaleString()}
          </div>
          {data.stalled.length === 0 ? (
            <div>Nothing is stalled. Keep going.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "grid", gap: "0.25rem" }}>
              {data.stalled.map((row) => (
                <li key={row.issueId}>
                  {row.title} <span style={{ opacity: 0.7 }}>({row.status}, {row.daysStalled}d)</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
