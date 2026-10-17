# Source and implementation choices

## Reel observations

- Source: [Ayo Omolewa (@ayoships), Instagram reel DeNKjDeyYIl](https://www.instagram.com/reel/DeNKjDeyYIl/).
- Examined on 2026-10-17 UTC. The page identifies publication as October 7, 2026;
  the player duration is about 47 seconds.
- Evidence: the public page, on-screen labels, and sampled frames across playback.
  A reliable audio transcript was not obtained. Do not present these notes as an
  exact spoken transcript or attribute unobserved claims to the creator.
- The visual sequence introduces an app-specific metric, OpenTelemetry with a
  tracing interface, and session replay. It then illustrates inspecting evidence,
  receiving a proposed change, comparing versions with an equal split, and
  retaining or changing the approach over repeated reviews.
- Treat the displayed percentages, charts, and time horizon as illustrations,
  not independently verified business results or a required experiment duration.

## Technical references

- [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/): use for
  observability. Define product events separately or deliberately route them to
  a backend capable of the required product analysis.
- [PostHog experiments](https://posthog.com/docs/experiments): one optional
  implementation of exposure tracking, flags, metrics, and experiment analysis.
- [PostHog session replay](https://posthog.com/docs/session-replay): one optional
  replay implementation; review current SDK-specific capture and masking controls.

Prefer the project's existing equivalent tools. PostHog is an implementation
option, not a verified endorsement from the reel. Recheck current official
documentation before choosing SDKs, configuration, prices, or API commands.

Statistical stopping plans, privacy checks, and authorization boundaries in the
skill are implementation safeguards; distinguish them from source observations.
