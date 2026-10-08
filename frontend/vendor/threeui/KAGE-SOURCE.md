# Kage registered source

Retrieved and verified on 2026-10-02 from:

- <https://threeui.com/landing-pages/kage.html>
- <https://threeui.com/source-code/kage-landing-page.json>

`kage-source-bundle.json` preserves the complete registered bundle. `kage-source-manifest.json` follows the existing vendor manifest format and omits the embedded code fields. Every one of its 8 source files and 14 binary assets matches the registered SHA-256 and byte count, including the hashes supplied in the ICARUS redesign brief. These reference files remain unchanged; presentation derivatives belong outside this directory.

## Server rewrites and exact recovery

The current server response differs mechanically from the registered source:

- Live HTML: 246,682 bytes, SHA-256 `da0df3a0f9245e369d1c25e452fbc959aaaee21cb98b08115027c4a040c9531c`.
- Registered HTML: 243,963 bytes, SHA-256 `c8e06b90397ac246baf0ab6f32f5f6b570acc6fe03c7009f711b579fb72d9f49`.
- Live font CSS: 1,995 bytes, SHA-256 `16b7c4c484f659486d09e44d1a415508e2d229765da0f3be78966a22cf2a73bb`.
- Registered font CSS: 99,356 bytes, SHA-256 `985f85a904a4096f92c06552b06f42a45973ac004af4780d68f18af65ddcc1b0`.

The server replaces the registered local image paths with public storage URLs, adds `crossorigin="anonymous"` to image tags, replaces `new Image()` with its storage helper, and injects that helper immediately after `<head>`. Reversing those changes produces the exact registered HTML hash and byte count. No authored markup, CSS, shader, timing, or behavior was changed.

The server also replaces embedded WOFF2 data URLs with public storage URLs. Each downloaded font's SHA-256 matches its storage filename. Replacing those URLs with `data:font/woff2;base64,` and the original bytes produces the exact registered font CSS hash and byte count.

The unmodified live responses are retained in `kage-provenance/served-kage.html` and `kage-provenance/served-fonts.css`. They are evidence, not application inputs. The registered HTML uses local asset paths and its registered font CSS carries embedded font bytes.

## Original runtime verification

The exact registered HTML was served locally and checked in a clean, sandboxed headless Chrome session before creating the ICARUS derivative. Launch and `?shot=3` both passed:

- `window.__kage` initialized without fallback.
- Six scroll chapters, 74 scene children, and a rendered 1440 × 900 canvas.
- Scroll progress was 0 at launch and approximately 3 at chapter 3.
- No JavaScript or console errors, failed requests, or external network requests.
- Screenshots were visually inspected for the authored temple, wordmark, and foreground scene.

Historical runtime evidence is retained locally and excluded from the source distribution. `npm test` verifies the registered files, and optional scene/Home QA scripts exercise the runtime. Desktop integration and the derivative require their own checks.

## Integration seams

The registered `KageLandingPage` export is a small `LandingPageFrame` wrapper with `splitTypographyProps` and `usePageTypography(KAGE_TYPOGRAPHY, ...)`. The complete `LandingPages.tsx` also imports other catalog pages that are outside the registered Kage bundle. An integration can extract only the exact Kage export into an application adapter while retaining this complete reference.

The original document exposes `window.__kage` with `RIG`, `WORLD`, `WORD`, `CAM`, `POST`, `renderer`, `scene`, `camera`, and `anchors()`. `WORLD.uT` shares the authored clock; `scene.onBeforeRender` can update derivative planes using the existing render loop. Center-based chapter anchors drive a six-waypoint Catmull-Rom camera curve, frame-rate independent damping, and foreground/reveal choreography. Keep adaptations separate from the reference and release the frame when leaving Home.
