# Paperclip control plane: application improvement profile

Repository: `thermanjr-oss/paperclip`.

## Scope and status

The owner requested this workflow across applications, with LITS prioritized for portfolio work. This branch adds agent guidance and measurement proposals. It does not implement event delivery, install an SDK, enable recording, run an experiment, deploy an application, or establish baseline results.

## Primary outcome proposal

Candidate activation: an operator-created company reaches its first reviewed task output within 24 hours / eligible new companies with a mature window.

Baseline counts, event coverage, active environment, cohort definition, and experiment allocation are unverified until inspected for the specific task. Report missing evidence instead of inventing rates.

## Evidence and event contract

Inspect existing packages/shared/src/telemetry and cli/server telemetry. Keep operational run-success metrics separate from a reviewed, useful task outcome.

Start with these existing source locations:
- `packages/shared/src/telemetry/events.ts`
- `packages/shared/src/telemetry/config.ts`
- `server/src/telemetry.ts`

Before adding events, define a versioned allowlist of event names, types, permitted coarse properties, source of truth, deduplication rule, and observation window. Use synthetic delivery tests. Do not add raw free text, URLs/query strings, or sensitive identifiers to analytics.

## App-specific constraints

Preserve company isolation, atomic checkout, approval gates, budget hard-stops, activity logs, and existing telemetry preferences. Exclude prompts, transcripts, private code, connector data, API keys, secret refs/values, and company documents from capture.

## Release and verification

Repository skill adoption does not install or activate anything in the owner's Mac instance. Use explicit agent/workspace configuration there; do not auto-start routines or expand permissions.

Follow the shared skill's experiment record and stopping plan. Review completed/abandoned journeys only where appropriate access and capture settings already permit it. Keep production collection and experiment rollout status explicit in every report.
