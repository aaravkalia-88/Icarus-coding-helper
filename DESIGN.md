# ICARUS — Design System & UX

This document includes product plans and design targets. See [ARC.md](ARC.md) for implemented behavior.

## 1. Design Direction

ICARUS should feel like a native macOS intelligence layer rather than a website placed inside a desktop window.

Visual direction:
- refined
- dark-neutral
- translucent
- tinted glass
- precise typography
- restrained motion
- subtle 3D depth
- minimal chrome
- strong keyboard affordances

The UI must use the contents of `refrence_ui/` as the highest-priority visual reference. Do not copy blindly; extract spacing, glass treatment, motion language, hierarchy, and interaction patterns and adapt them into a consistent ICARUS system.

## 2. Visual Character

Think:
- macOS command surface
- spatial glass layers
- soft edge lighting
- tiny luminous depth cues
- polished developer tooling

Avoid:
- generic SaaS dashboard styling
- oversized cards
- excessive gradients
- neon cyberpunk visuals
- constant 3D animation
- glass so transparent that text loses contrast
- random glowing borders

## 3. Design Tokens

Create CSS custom properties rather than hardcoding repeated values.

Suggested groups:

```css
:root {
  --bg-app: rgba(10, 11, 14, 0.82);
  --bg-glass: rgba(24, 25, 30, 0.58);
  --bg-glass-strong: rgba(28, 30, 36, 0.78);
  --border-glass: rgba(255, 255, 255, 0.11);
  --border-highlight: rgba(255, 255, 255, 0.18);
  --text-primary: rgba(255, 255, 255, 0.94);
  --text-secondary: rgba(255, 255, 255, 0.62);
  --text-muted: rgba(255, 255, 255, 0.40);
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --blur-glass: 28px;
}
```

Treat these as starting points; tune them after reviewing `refrence_ui/`.

## 4. Typography

Preferred:
- SF Pro / system UI stack for application chrome
- SF Mono or a clean system monospace for code

Hierarchy:
- compact labels
- medium-weight titles
- readable body copy
- monospace only where it adds meaning

Do not turn the whole UI into terminal typography.

## 5. Quick Glass Panel

This is the defining ICARUS interaction.

### Placement
- appears within approximately 12–20 px of cursor
- never extends beyond current display bounds
- automatically repositions if near edges
- visually points toward the invocation location without using a cartoon speech bubble

### Shape
- compact rounded rectangle
- layered translucent material
- subtle inner highlight
- restrained shadow
- no thick outline

### Default Command Menu
Suggested commands:
- Logic Coach
- Explain Mistake
- Fix Code
- Hint
- Explain Code
- Refactor
- Ask Icarus

Keyboard shortcut numbers or letters may appear on hover/focus.

### Interaction
- arrow keys change selection
- Enter confirms
- Escape closes
- typing immediately switches into Ask Icarus search/input

## 6. Glass Material

Use:
- `backdrop-filter: blur(...) saturate(...)`
- semi-transparent fill
- 1 px translucent edge
- small top-edge highlight
- multi-layer shadow

The panel should still remain readable over bright editors, dark terminals, and browsers.

A tint can react subtly to mode:
- Logic Coach: cool neutral
- Fix: slightly warmer neutral
- Hint: soft muted tint

Do not make modes strongly color-coded. Text and icons must remain the primary signal.

## 7. Motion System

Use Framer Motion for interface motion.

### Open
- 120–180 ms
- opacity + slight scale from ~0.97
- very small vertical translation
- spring only if it remains controlled

### Mode Transition
- shared-layout transition
- avoid full panel remount flashes

### Streaming
- no bouncing loader
- use understated shimmer/skeleton before first token
- then transition into real content without layout jump

### Dismiss
- quicker than open
- approximately 90–130 ms

Respect macOS Reduce Motion.

## 8. Three.js Usage

Three.js should provide identity, not become the UI framework.

Good uses:
- subtle Icarus wing/feather emblem in onboarding
- slow refractive light object in empty assistant state
- soft reactive depth behind hero/settings about panel
- tiny ambient visual while the model is thinking

Rules:
- lazy-load all Three.js scenes
- pause animation when hidden
- reduce quality on battery if required
- never block command interaction
- never make the user wait for WebGL to use the app

## 9. Response Card

The response panel expands from the same command surface.

Header:
- mode icon
- mode name
- detected language
- model indicator
- close / expand

Body:
- concise explanation
- code block if needed
- optional diff
- hint progression in Hint Mode

Footer actions:
- Copy
- Replace
- Diff
- Follow-up
- Retry

Do not display every action all the time. Prioritize 2–3 actions and place secondary controls in an overflow menu.

## 10. Code Presentation

- high-quality syntax highlighting
- line numbers only for longer blocks
- selectable text
- copy button
- wrap toggle
- diff mode
- changed lines visually distinct without extreme red/green saturation

For Fix Code, default to explanation + patch/diff before full replacement.

## 11. Logic Coach UX

The surface should visibly prioritize learning.

Recommended sequence:
1. “What your code is trying to do”
2. “Where the reasoning breaks”
3. “Think about this”
4. “A stronger approach”
5. corrected code when appropriate

Add a small “Show less / Show more guidance” control rather than overwhelming the first view.

## 12. Hint UX

Use progressive disclosure.

Initial view:
- Hint 1
- button: `Give me another hint`

Second:
- Hint 2

Third:
- Hint 3 / pseudocode

Provide a separate explicit action to switch to Fix mode if the user wants the full solution.

## 13. General Assistant

Expanded view layout:
- narrow conversation column
- optional project context drawer
- input docked at bottom
- local-memory badge when memory contributes context
- model switcher kept unobtrusive

Slash commands are optional for later versions.

## 14. Skeleton Loaders

Use skeletons for:
- response first-token wait
- history list
- memory list
- project file context
- model list
- settings provider validation

Skeleton design:
- tinted glass blocks
- subtle horizontal shimmer
- same dimensions as final content
- no dramatic pulsing

Never show a blank card during loading.

## 15. Error States

Errors should be specific and actionable.

Examples:

### Invalid API Key
“ICARUS could not authenticate this provider.”
Actions:
- Re-enter key
- Test again
- Use local model

### Accessibility Permission Missing
Explain exactly why selected-text access is needed and provide a button to open the relevant macOS Settings pane.

### Backend Offline
Show retry and restart-backend actions.

### Network Offline
If a local model exists, offer it directly.

## 16. Custom 404

Internal route title:
**Lost in the Labyrinth**

Visual:
- minimal broken-wing line/3D motif
- soft glass surface

Copy:
“The view you tried to open doesn’t exist.”

Actions:
- Return to Icarus
- Open Command Menu

Do not make this screen comedic or noisy.

## 17. Settings Design

Use a native-preferences style layout, not a dashboard.

Left rail or compact segmented navigation:
- General
- Shortcut
- AI Models
- Local Models
- Memory
- Privacy
- Appearance
- Projects
- Advanced

Each page should use short grouped settings with clear descriptions.

## 18. Onboarding Design

Keep onboarding short and interactive.

### Step 1
Icarus mark + one-sentence explanation.

### Step 2
Accessibility permission with visual example of selection → shortcut → panel.

### Step 3
Choose:
- Local model
- API provider
- Skip for now

### Step 4
Interactive test:
- sample code selected inside onboarding
- press shortcut
- confirm panel works

## 19. Microinteractions

Recommended:
- subtle icon morph between command and response state
- selection highlight glides rather than snaps
- copy action briefly changes to checkmark
- replace action uses a short confirmation state
- model status dot animates only during connection/testing
- glass reflection shifts by a few pixels with pointer movement only in large surfaces, never in text-heavy panels

## 20. Iconography

Use Lucide icons or a similarly restrained set.

Do not mix multiple icon families.

Icarus brand icon should be custom and simple enough to work at 16–20 px.

## 21. Responsiveness

Although macOS-only initially, support:
- small MacBook screens
- high-DPI displays
- multiple monitors
- Stage Manager
- full-screen apps where system APIs allow overlay behavior

Quick Panel should define compact, standard, and expanded widths rather than fluidly growing without limits.

## 22. Reference UI Rule

Before implementing any major surface, agents must inspect `refrence_ui/`.

They should record:
- useful spacing rules
- material/glass behavior
- typography cues
- animation cues
- menu geometry
- icon treatment

Then implement an original ICARUS version consistent with those references.

If a reference conflicts with usability, accessibility, security, or product requirements, follow the requirements and preserve only the useful visual language.

## 23. Quality Bar

Before a screen is considered complete:
- no placeholder copy
- no broken or generic loading state
- no uncaught overflow
- keyboard navigation works
- dark and bright desktop backgrounds tested behind glass panel
- panel remains readable
- animations are smooth
- Reduce Motion works
- no inaccessible icon-only control
- empty/error states exist
- real data path is connected
- no mock interaction presented as functional
