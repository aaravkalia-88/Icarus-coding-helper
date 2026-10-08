---
name: add-glass-ai-button
description: "Build Glass AI Button from its verified authored source using Embedded Three.js r170 + custom GLSL + DOM/CSS, including the complete renderer, interactions, and required assets. Use when Codex needs to implement, port, or adapt this effect without requiring the ThreeUI package or reconstructing the visual from an approximation."
---

# Build Glass AI Button

## Description

A translucent glass AI button with a deep-blue galaxy orb, luminous GPT 6 Sol lettering, a traced brain icon, and a particle burst on activation.

Recreate the authored behavior from the verified source, not from screenshots or the abbreviated orchestration sample in this skill. The implementation may live directly in the target project and does not require `@designcodeio/threeui`.

## Technologies

- React and TypeScript visibility-aware sandbox host
- Self-contained Three.js r170 and custom GLSL document
- Procedural glass, galaxy particles, caustics, and bloom

## Verified source material

- `src/shaders/glass-ai-button/GlassAiButton.tsx`
- `src/shaders/glass-ai-button/sources/glass-ai-button.html`

Source revision: `SHA-256 a484571de316`

## Implementation steps

1. Open every verified source file listed above and identify the renderer, host lifecycle, styles, and assets before editing.
2. Copy the React host and adjacent `sources/glass-ai-button.html` together; preserve the HTML byte-for-byte.
3. Import the source as a raw string in an opaque allow-scripts-only `srcDoc` iframe.
4. Keep the authored WebGL scene, responsive framing, semantic button, replay and pause controls, keyboard activation, and reduced-motion behavior.
5. Unmount the iframe while its host or document is hidden to release the WebGL resources.
6. Give the local component a sized, overflow-controlled parent and verify desktop, mobile, reduced-motion, and context-loss behavior.

Asset handling: Copy `GlassAiButton.tsx` and its adjacent `sources/glass-ai-button.html` together. The Three.js runtime, shaders, glass geometry, galaxy particles, brain icon, caustics, and bloom are embedded; no runtime network access or companion asset is required.

## Local component example

Import the copied local component rather than a package entrypoint:

```tsx
import { GlassAiButton } from "./effects/glass-ai-button/GlassAiButton";
import "./effects/glass-ai-button/styles.css";

export function Scene() {
  return <div className="effect-frame"><GlassAiButton /></div>;
}
```

## Core renderer pattern

This excerpt documents orchestration only. Copy the exact shader, geometry, pass, and interaction code from the verified source files.

```tsx
<GlassAiButton />
```

## Behavior contract

- Runtime: Embedded Three.js r170 + custom GLSL + DOM/CSS
- Passes: Three.js glass and galaxy scene, caustic floor prepass, bloom, and final composite
- Interaction: Pointer hover tilts and illuminates the glass; pointer press or keyboard activation launches a galaxy particle burst. Replay and pause controls are included.
- Assets: Embedded Three.js runtime, procedural glass and galaxy shaders, canvas-drawn icon, and system typography. No external asset requests.
- **document** (fixed): Complete original `glass-ai-button.html`, byte-for-byte
- **renderer** (sandbox): Opaque allow-scripts-only HTML document
- **interaction** (original): Pointer hover and tilt, activation burst, replay, pause, keyboard focus, and reduced-motion support
- **lifecycle** (adaptive): Iframe mounts only while its host and document are visible
- **assets** (original): Self-contained Three.js runtime and procedural artwork; no runtime asset requests

## Verification

1. Compare the rendered composition, animation timing, pointer behavior, and state transitions with the source implementation.
2. Exercise resize, high-DPI, mobile/coarse-pointer, reduced-motion, tab visibility, and WebGL context-loss paths where applicable.
3. Confirm every animation frame, observer, listener, geometry, buffer, texture, framebuffer, material, and renderer is released on teardown.
4. Check the browser console and confirm the effect renders at native-or-better backing resolution.

## Guardrails

- Do not substitute a visually similar package, demo, shader, or runtime.
- Do not approximate, reconstruct, or simplify the authored GLSL, render passes, geometry, interaction state, or assets.
- Keep exact source and asset hashes under regression tests when the source project provides them.
- Adapt only the surrounding host boundary needed by the target project; keep renderer behavior intact.
