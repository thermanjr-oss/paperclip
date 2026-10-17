---
name: improve-apps-with-data
description: Use when improving app activation, retention, conversion, or another product outcome from usage evidence, diagnosing a stalled user journey, or planning an A/B experiment; also when applying Ayo Omolewa's telemetry and session-replay workflow.
---

# Improve Apps with Data

Turn observed user friction into one measurable, reversible experiment. Read
[source-and-tools.md](references/source-and-tools.md) for the reel's observed
method and the distinction between its examples and implementation choices.
Read [application.md](references/application.md) for this repository's proposed
metric, existing evidence sources, sensitive-data exclusions, and release constraints.

## Establish the measurement

Identify the app, user journey, current deployment, available data, and requested
scope. Reuse existing tools and hosting. Creating this skill does not authorize
changes to every app, new services, or production experiments.

Choose one primary outcome tied to user value. Define the eligible population,
numerator/denominator or unit, measurement window, desired direction, and baseline
counts. Examples include completed signup-to-first-use or successful scheduled
publishing. Avoid optimizing time spent or clicks without a value hypothesis.

Keep these evidence sources distinct:

| Evidence | Purpose |
| --- | --- |
| Product events and funnels | Measure actions, abandonment, retention, and conversion |
| OpenTelemetry traces, metrics, and logs | Explain latency, errors, and service behavior |
| Session replays | Examine interactions and generate friction hypotheses |

Infrastructure traces alone do not establish a product conversion funnel. If
outcome events are absent, prepare an event contract and validate collection
before interpreting experiments. Replays suggest explanations; they do not prove
causation. Report missing access or data explicitly.

## Make the evidence usable

Correlate pseudonymous session, release, and experiment identifiers. Check event
definitions, timestamps, duplicates, internal/bot traffic, assignment, and actual
variant exposure. Verify a known synthetic journey reaches the expected events.

Before recording, mask inputs and sensitive content and exclude authentication,
payment, medical intake, identity documents, and private messages. Check network
and console capture too. Verify masking with synthetic data and respect applicable
consent, access, and retention settings. Give agents redacted or aggregate evidence.

Inspect representative completed and abandoned journeys alongside telemetry.
Separate confirmed defects from behavioral hypotheses. Fix reproducible broken
flows directly within scope; do not make users endure a known bug as a control.

## Test one hypothesis

State: observed friction, proposed change, expected effect, and evidence that would
disprove it. Prepare one small patch behind a reversible flag when appropriate.
Preserve security, verification, consent, and existing plan/trial promises.

Before launch, specify control and variant, stable randomization unit, exposure
event, primary metric, sample/duration plan, analysis method, and guardrails such
as errors, latency, refunds, or retention. A 50/50 split is an option, not a rule.
Keep cohorts concurrent and account for the outcome's observation window.

Verify event delivery, sticky assignment, both variant journeys, and rollback.
Prepare reviewable changes and checks; deploy or alter live traffic only within
the user's existing authorization.

## Evaluate and iterate

Report counts, rates, absolute and relative changes, uncertainty, data quality,
and guardrail results. Daily inspection does not justify daily winner selection:
use the prespecified fixed-sample or valid sequential method. Label low-traffic or
incomplete results inconclusive; do not invent significance or guaranteed growth.

Return a compact experiment record: metric, evidence, hypothesis, change,
validation, results, and keep/revert/continue decision. Paperclip agents can help
query available evidence, prepare patches, and maintain this record. Create
recurring reviews only when the user requests scheduling.
