# ICARUS — Product Requirements

This document includes product plans and design targets. See [ARC.md](ARC.md) for implemented behavior.

## 1. Product Summary

ICARUS is a macOS-first desktop programming companion that appears exactly when the user needs help. Instead of forcing the developer to open a full chat window, the user selects code or text in any supported editor, presses a global shortcut, and ICARUS opens a compact tinted Apple-style glass panel close to the cursor.

ICARUS is designed to improve the developer, not only replace their work. It can explain mistakes, strengthen programming logic, offer hints without revealing the full solution, correct code, refactor code, explain unfamiliar code, and answer general technical questions.

Initial language support:
- Python
- C
- C++
- Java
- JavaScript
- HTML
- CSS

Primary platform: macOS.

## 2. Core Product Principles

1. **Contextual, not intrusive** — appears only when invoked.
2. **Teach before replacing** — learning modes should help the user understand why.
3. **Fast** — selection to visible response should feel immediate.
4. **Local-first** — app state, memory, settings, cache, history, and indexing remain on the device.
5. **Private by default** — only necessary context is sent to a remote AI provider when the user chooses a remote model.
6. **Beautiful but functional** — animation must support usability, not delay it.
7. **Keyboard-first** — every important action has a shortcut.
8. **Project-aware** — ICARUS can understand the current project when the user grants folder access.

## 3. Primary Interaction

### Selection Flow

1. User highlights code or text in an editor, terminal, browser, or supported application.
2. User presses the global ICARUS shortcut, default: `Cmd + Shift + I`.
3. ICARUS captures the selected text using the macOS Accessibility API, with clipboard fallback where required.
4. A compact glass command menu appears near the current pointer position.
5. User selects a mode with keyboard or mouse.
6. ICARUS shows a skeleton state immediately.
7. Response streams into the same panel.
8. User can copy, replace selection, open expanded view, ask a follow-up, or dismiss with `Esc`.

### No Selection Flow

If no code is selected, ICARUS opens in General Assistant mode and can answer programming, project, or general technical questions.

## 4. Main Modes

### Logic Coach
Purpose: improve reasoning rather than only output code.

Behavior:
- Identify the intended goal.
- Explain the flaw in the current reasoning.
- Break the problem into smaller steps.
- Ask the user to think through critical steps when useful.
- Provide corrected code only after the explanation, unless the user asks for hints only.

### Mistake Explainer
Purpose: explain what is wrong and why.

Output structure:
- What happened
- Why it happened
- Where the issue is
- How to think about it
- Corrected version
- How to avoid the same mistake

### Fix Code
Purpose: produce a corrected version quickly.

Behavior:
- Preserve language and intended behavior.
- Change only what is required unless the original design is unsafe or broken.
- Show concise explanation and corrected code.
- Provide a patch/diff when practical.

### Hint Mode
Purpose: help without revealing the full answer.

Levels:
- Hint 1 — conceptual direction
- Hint 2 — stronger clue
- Hint 3 — pseudocode or partial structure

Hint Mode must not automatically reveal a full completed solution.

### Explain Code
Purpose: make selected code understandable.

Behavior:
- Explain purpose
- Explain important variables/functions
- Describe control/data flow
- Identify complexity where relevant
- Highlight confusing or risky sections

### Refactor / Improve
Purpose: improve readability, maintainability, performance, or structure.

Options:
- Cleaner
- Faster
- More readable
- More idiomatic
- Safer
- Better documented

### General Assistant
A normal chat surface for programming and technical help, using the same local project context and memory when enabled.

## 5. Secondary Features

- Project folder context with explicit user permission.
- Recent files and recently used snippets.
- Local searchable conversation history.
- User-controlled memory of coding preferences.
- “Forget this” and “Clear project memory” controls.
- Syntax-highlighted code blocks.
- One-click copy.
- One-click replace selected text where macOS permissions allow it.
- Diff preview before replacement.
- Retry / regenerate.
- Continue response.
- Stop generation.
- Pin expanded assistant window.
- Keyboard navigation.
- Multiple AI-provider adapters.
- Optional fully local AI through Ollama or LM Studio.
- Remote provider support through user-supplied API keys.
- Model selector.
- Token/context indicator for advanced settings.
- Offline state detection.
- Error recovery and retry.
- Per-project memory toggle.
- Per-project custom instructions.
- Language auto-detection.
- Automatic prompt routing based on selected mode and language.

## 6. Desktop Surfaces

### Quick Glass Panel
Primary interaction surface near the cursor.

States:
- command menu
- loading / skeleton
- streaming answer
- error
- completed answer
- confirmation before replacing code

### Expanded Assistant
A resizable floating window for longer conversations, multi-file context, and project-level questions.

### Settings
Sections:
- General
- Shortcuts
- Models & API
- Local Models
- Memory
- Privacy
- Appearance
- Project Access
- Advanced

### Onboarding
Keep to 3–4 steps:
1. Welcome
2. Accessibility permission
3. Choose AI provider or local model
4. Test shortcut

## 7. Local Memory

ICARUS stores memory locally in:

`~/Library/Application Support/Icarus/`

Recommended storage:
- SQLite for conversations, settings, project references, and memories.
- SQLite FTS5 for fast local text retrieval.
- Local disk cache for temporary response/session data.
- Optional local embedding index later if semantic project memory is needed.

Memory categories:
- global preferences
- coding style preferences
- project-specific facts
- recent interaction summaries
- explicit pinned memories

Rules:
- Memory is opt-in by category.
- The user can inspect and delete memory.
- Never store API keys in SQLite.
- Never silently index an entire filesystem.
- Project indexing requires explicit folder access.

## 8. AI Connectivity

The app itself, UI, state, history, memory, and project cache run locally.

AI execution supports two paths:

### Local Mode
Use Ollama or LM Studio through localhost. No source code needs to leave the machine.

### Remote Mode
Use a provider adapter with a user-supplied API key. Only the context needed for the current request is transmitted.

Keys must be stored in macOS Keychain, never committed to source or written to plaintext config files.

Provider adapters should expose one common interface so the UI does not depend on a specific model vendor.

## 9. Performance Targets

- Glass panel visible: under 150 ms after shortcut.
- Skeleton state visible immediately.
- Local UI interactions: 60 fps target.
- Avoid blocking the main Electron renderer during indexing, parsing, or AI calls.
- Stream remote/local model responses.
- Lazy-load Three.js visual effects.
- Keep idle CPU usage close to zero.

## 10. Reliability Requirements

- App starts at login only if enabled by user.
- Global shortcut collision handling.
- Graceful handling when Accessibility permission is missing.
- Graceful fallback if selection capture fails.
- Retry on recoverable network errors.
- Clear error states instead of blank panels.
- If Python backend crashes, desktop shell should restart it once and surface a useful error if recovery fails.
- Never lose the current draft on a transient provider failure.

## 11. Error / Empty / Loading States

Required states:
- skeleton loaders for menus, chat, project context, model list
- animated typing/stream indicator
- no-selection state
- no-project state
- model unavailable state
- offline state
- invalid API key state
- permission denied state
- backend unavailable state
- empty memory state
- empty history state

### Custom 404
ICARUS is a desktop app, but any internal routed page that cannot be resolved should show a custom “404 / Lost in the Labyrinth” screen with:
- subtle Icarus wing visual
- return to assistant action
- open command palette action
- no generic browser-style 404 page

## 12. Accessibility

- Full keyboard navigation.
- Visible focus states.
- Respect macOS Reduce Motion.
- Respect system contrast where possible.
- Avoid using blur/transparency as the only way to separate layers.
- Tooltips for icon-only controls.
- Screen-reader labels for all controls.

## 13. Privacy & Security

- API keys in macOS Keychain.
- Local backend bound to `127.0.0.1` only.
- Random authenticated session token between Electron and FastAPI.
- Strict CORS allowlist.
- No arbitrary shell execution from AI output.
- No automatic execution of generated code.
- Any file edit requires explicit user action or enabled project-edit permission.
- Sanitize Markdown and HTML before rendering.
- Disable Electron `nodeIntegration` in renderer.
- Enable `contextIsolation`.
- Use a narrow preload bridge.
- Validate every IPC payload.
- Never log secrets or full API keys.
- Redact secrets detected in selected text before remote transmission when possible.

## 14. MVP Definition

The MVP is complete when a user can:
1. Install and launch ICARUS on macOS.
2. Grant Accessibility permission.
3. Add a provider key or connect a local model.
4. Highlight Python/C/C++/Java/JS/HTML/CSS code in a common editor.
5. Press the global shortcut.
6. Open the glass menu near the cursor.
7. Choose Explain, Fix, Logic Coach, Hint, or Refactor.
8. Receive a streamed result.
9. Copy or safely replace the selected code.
10. Open General Assistant.
11. Reopen recent history and local memory.
12. Change model, shortcut, appearance, and privacy settings.

## 15. Later Roadmap

- Multi-file reasoning.
- Local repository map.
- Git diff awareness.
- Terminal error capture.
- Test generation.
- Debug trace explanation.
- Voice command mode.
- IDE plugins.
- Local coding knowledge graph.
- Optional agent mode with explicit approval for every file/system action.
- Context-aware unit test runner.
- Plugin/skill system for new programming workflows.
