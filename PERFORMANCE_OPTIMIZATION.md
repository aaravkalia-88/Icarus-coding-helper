# ICARUS Thermal & Performance Update

10 October 2026. This update reduces unnecessary rendering and asset parsing. It
does not alter macOS thermal protections or promise a particular temperature.

## Changes

- Electron explicitly enables background throttling, keeps hardware acceleration,
  disables offscreen rendering, and disables DevTools outside the localhost
  development server. The existing popup is reused and starts genuinely hidden.
- Native show, hide, minimize, and restore events publish a deduplicated boolean
  through the isolated preload. A read-only initial-state request handles late
  subscriptions; reloads receive the current state. No cursor or status poll was
  added.
- Library, Kage, and glass frames retain their state while hidden. Their parent
  combines native visibility, document visibility, viewport intersection, and
  modal state. Sandboxed children accept lifecycle messages only from their parent.
  Hidden CSS animations, media playback, main WebGL frames, and cloth simulations
  stop; visible interaction resumes immediately with a bounded time delta.
- The custom cursor coalesces pointer events and stops scheduling frames when it
  reaches its target. Reduced-motion Kage and paused glass finish their current
  transition and stop drawing. Visible intentional particles, videos, cloth,
  lighting, and glass motion retain their authored rendering frequency.
- Camera anchors refresh on layout changes, navigation, and scrolling. This
  corrects the stale footer anchor found in native verification without polling.
- Six book covers are extracted into content-addressed JPEG/MP4 files at build
  time. Tests compare every byte with the originals. No compression, resizing,
  pixel-ratio change, shader change, or visual-effect removal was applied.
  Heavy settings, models, and Kage routes already use lazy imports.

The changes reach Electron main/preload and renderer types, the three application
frame adapters, landing/home/popup lifecycle callers, build preparation, sandbox
asset serving, generated application pages, and their regression/QA checks.
Registered vendor sources and their integrity manifests remain unchanged.

## Measurements

The baseline was built before implementation. Both runs used the production Vite
and Electron bundles through `icarus://app`, with hardware acceleration enabled,
temporary local data, and no model inference. Samples cover three seconds after
startup/transitions. Instrumentation counts animation-frame callbacks and WebGL
draw calls in the selected sandbox frame. `app.getAppMetrics()` supplies process
CPU and working-set snapshots; the CPU numbers are Electron's reported values,
not Activity Monitor's per-core percentages or hardware GPU utilization.

Baseline and final verified samples:

| Measurement | Before | After |
| --- | ---: | ---: |
| Minimized Kage animation callbacks / 3 s | 360 | 0 |
| Minimized Kage WebGL draw calls / 3 s | 22,500 | 0 |
| Kage behind settings, WebGL draw calls / 3 s | 22,622 | 0 |
| Minimized library playing videos | 3 | 0 |
| Minimized library/Kage running CSS animations | 9 | 0 |
| Minimized Kage total Electron process CPU | 6.815% | 0.184% |
| Minimized Kage GPU-process CPU | 4.094% | 0.123% |
| Minimized library total Electron process CPU | 4.104% | 0.131% |
| Visible library renderer working set, summed | 450.6 MiB | 380.1 MiB |
| Main JavaScript chunk, uncompressed | 3,561.64 kB | 71.44 kB |
| Main JavaScript chunk, gzip | 2,643.34 kB | 18.70 kB |

These are short samples, not a statistical benchmark. CPU and memory vary with
scene state, warm-up, decoding, garbage collection, and other applications. The
strongest verified result is zero visual callbacks/draws in suspended scenes.
Visible Kage still renders its intentional atmosphere; its GPU workload remains
substantial. Total image/video bytes are unchanged, now separate from JavaScript.

Screenshots of the library and Kage were reviewed before/after. Artwork, text,
glass, colors, and scene composition remain consistent; intentional animation
phases and pointer parallax can differ between screenshots.

## Verification and repeatable checks

Run from `frontend`:

```sh
npm run build
npm run lint
npm test
npm run test:home
npm run test:performance
```

Native QA requires a local Playwright installation. Existing scripts accept
`ICARUS_PLAYWRIGHT_MODULE` pointing to the bundled workspace runtime; no dependency
was added to the application. The performance probe disables physical input only
on its temporary test window to keep measurements stable, exercises navigation,
minimize/restore, modal suspension, reduced motion, and glass pause/play, then
closes the owned app and removes temporary data. Results/screenshots remain in
ignored `docs/verification/`.

From the project root, `python3 -m pytest backend -q` checks the backend.

TDD evidence: the initial four regressions failed for perpetual cursor frames,
missing explicit lifecycle, window preferences, and embedded media. Checkpoint
`b49d124` preserves that RED state. Further executed failing checks covered native
state publication, changed preparation anchors, and a reduced-motion preference
changed while hidden. They now pass. Runtime fixtures cover cursor convergence,
event coalescing, cancellation/resume, message-source/type validation, deduplication,
prior media state, and lifecycle cleanup. Integrity tests preserve registered
source revisions, rendering passes, and original media bytes.

The scene preparation module has 100% Node line, branch, and function coverage.
Whole-suite Node coverage is 55.40% lines, 90.64% branches, and 81.82% functions,
because the native Electron entrypoint and
React/browser execution are outside that runner; native smoke and performance
checks cover those separately. This is not a claim of 80% whole-app coverage.

Final automated results: production/native build, TypeScript check, lint, and diff
whitespace review passed; 45 frontend and 125 backend tests passed. The release
performance probe passed all suspension, reduced-motion, and glass-play assertions
with no captured page errors. Native smoke passed library entry, all section
navigation, all eight native modes, memory/settings access, narrow layout, and
reduced motion with no captured page errors. Hardware tests and the coverage limit
below remain explicit gaps.

## Backend and security audit

The existing supervisor already deduplicates backend startup, permits one bounded
restart, owns only its spawned child, and stops it on quit. There are no idle
filesystem scans or backend status intervals. Requests/streams have size and time
limits, cancellation, bounded conversation input, and a 50-answer local cache.
Those behaviors and provider/memory/security tests are retained.

Provider HTTP clients remain request-scoped. Custom endpoints validate and pin DNS
per request; no connection-pool rewrite was introduced without provider profiling.
The lifecycle carries no credentials or user content. Native IPC checks the exact
top-level sender; srcDoc frames retain opaque sandbox origins, and API keys remain
in Keychain. The diff adds no dependency or credential and keeps isolation,
sandboxing, web security, navigation denial, and local-backend authentication.

## Limits and remaining risks

- Visible authored animations necessarily consume CPU/GPU. Achieving zero visible
  animation workload would require changing their behavior, contrary to the brief.
- No temperature, fan-speed, battery, hardware GPU-counter, or long-duration
  memory-soak measurements were made. No measured temperature or wattage reduction
  is claimed. Backend memory and live provider inference were not profiled.
- React DevTools Profiler was not run. Source inspection found no React state
  updates per animation frame; new visual state uses refs and event callbacks.
- Multi-display placement retains existing negative-origin/edge unit tests; a
  physical multi-monitor setup was not exercised.
- The build retains existing large settings-chunk and unresolved
  `fragment-mono.woff2` warnings. App/window initialization and visible animations
  still have real costs. Local model servers can independently heat the machine.
- Dormant registered sword scenes are not mounted by the app and were left intact.
  The update targets the library, Kage, glass, and native popup actually used.
