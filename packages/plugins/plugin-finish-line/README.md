# Finish Line

A Paperclip plugin that finds stalled work. It scans your issues every day, lists the stalled ones on the dashboard, and posts one nudge comment on each newly stalled issue.

An issue is **stalled** when it has had no activity for `staleDays` days (default 5). Activity is the later of the issue's `updatedAt` and `lastActivityAt`.

## What it does

- **Daily scan.** The `scan-stalled` job runs at 09:00. It checks every company and saves each company's stalled issues, oldest first.
- **Dashboard widget.** "Stalled work" shows each stalled issue with its status and days stalled. **Scan now** refreshes the list right away.
- **One nudge per stall.** The daily job posts this comment on each newly stalled issue:
  > No activity on this issue for N days. Is it blocked, or ready to move?

  The plugin does not comment again until someone touches the issue and it stalls again. Its own comment never counts as activity.

**Scan now never posts comments.** Only the daily job nudges.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `staleDays` | `5` | Days without activity before an issue is stalled. Minimum 1. |
| `nudgeEnabled` | `true` | Post nudge comments. Set to `false` to only show the widget. |
| `excludedStatuses` | `["done", "cancelled", "backlog"]` | Issues in these statuses are ignored. |
| `maxNudgesPerRun` | `20` | Most nudge comments per company in one daily run. Older stalls go first. The rest wait for the next run. |

Invalid values fall back to the defaults.

## Capabilities

`jobs.schedule`, `companies.read`, `issues.read`, `issue.comments.create`, `plugin.state.read`, `plugin.state.write`, `ui.dashboardWidget.register`

The plugin keeps its own state (last scan results and nudge records) in plugin state. It has no database tables.

## Install

From a local checkout:

```bash
pnpm install
pnpm build
paperclipai plugin install /absolute/path/to/plugin-finish-line
paperclipai plugin list
```

Local installs run trusted code from that folder. Plugin UI runs inside the Paperclip app, so only install code you trust.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm dev            # watch builds
```

Source layout:

- `src/stale.ts`: staleness rules, config parsing, nudge text (no host calls)
- `src/scan.ts`: scanning, saved results, nudging
- `src/worker.ts`: job, data handler (`stalled`), action (`scan-now`)
- `src/ui/index.tsx`: dashboard widget
- `tests/`: unit tests and a simulated-host test harness

## Status

Version 0.1.0. The Paperclip plugin API is alpha, so this plugin may need updates when the API changes.

Not in v0.1: waking or reassigning agents, per-project thresholds, and Slack or email alerts.

## License

MIT
