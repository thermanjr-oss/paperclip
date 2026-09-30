# Finish Line

Finds stalled issues, shows them on the dashboard, and nudges once per stall.

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

`pnpm dev` rebuilds the worker, manifest, and UI bundles into `dist/`.
When this package is installed from a local path, Paperclip watches that rebuilt
output and reloads the plugin worker. Local installs run trusted code from this
folder on your machine.



## Install Into Paperclip

```bash
paperclipai plugin install /home/user/paperclipai/paperclip/packages/plugins/plugin-finish-line
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
