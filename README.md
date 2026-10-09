# ICARUS

A macOS programming companion for the code in front of you. Open a mode from the animated library and workspace, or select text in another app and press **⌘⇧Q**. Answers stream into a desktop panel with Copy, Retry, Stop, and follow-up questions.

Available modes: Hint Mode, Explain My Mistake, Improve Logic, Fix Code, Full Solve, Ask ICARUS, Explain Code, and Refactor. Project notes and recent answers stay in local storage. Connections support Hugging Face, OpenAI, Ollama, and LM Studio.

See [the implemented architecture](ARC.md), [product plans](PRO.md), and [design guidance](DESIGN.md). Product and design documents also contain future ideas; the architecture describes current behavior.

## Setup and launch

The desktop app requires macOS, Node.js/npm, Python, and Xcode Command Line Tools. The native build uses the active macOS SDK selected by `xcrun`. Verification used Node.js 24 and Python 3.14; other toolchain versions have not been verified.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cd frontend
npm ci
cd ..
./start.sh
```

The launcher builds the renderer, Electron shell, and Swift helpers. Electron starts its own authenticated local Python service. `start.sh` uses the project's `.venv/bin/python3` when available, preserves an already active Python environment, and honors `ICARUS_PYTHON` when you set it explicitly. Otherwise it uses `python3` from your PATH.

Stop with **Ctrl+C** or `./stop.sh`. `./start_web.sh` and `./stop_web.sh` run only the browser UI on localhost. Native shortcuts, selection capture, Keychain, and model requests require the desktop app.

## Connect a model

Open Model connection, choose a provider and model ID, then use **Test & save connection**. Remote providers require a token; local servers must already be running. Tokens stay in macOS Keychain and are never returned to the renderer. Grant the selection helper Accessibility access in macOS settings to capture highlighted text, or paste code into the panel.

Submitted code, explicitly selected project context, and follow-up exchanges go to the selected provider. Recognized secrets are redacted before remote requests, but redaction is best effort. The app displays AI output as text and does not execute generated code or automatically replace editor contents.

## Verification

```sh
python -m pytest backend tests -q
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use local server fixtures and Swift Security API fixtures; the Keychain fixture does not use real credentials. Launcher tests need permission to inspect and stop their own processes.

Optional browser QA requires Playwright and Chrome. Install Playwright in the development environment, or set `ICARUS_PLAYWRIGHT_MODULE` to its module path, then run:

```sh
node --test scripts/verify-error-handling.mjs
```

Additional scene, Home, and popup checks are under `frontend/scripts`. Some native QA scripts use real desktop integration and should be reviewed before running against saved connections.

## Source and local files

`frontend/vendor/threeui` retains registered source bundles, manifests, original assets, and provenance. Preparation scripts validate these and create ICARUS derivatives; edit those scripts or React wrappers rather than generated HTML. Bundled Three.js licensing is retained under `frontend/public/vendor/three`.

Git excludes dependencies, generated builds, local databases, environment secrets, QA evidence, private working notes, cleanup backups, and submission presentations. These rules protect Git uploads; uploading the entire folder manually would include local-only files.

ICARUS uses the existing [MIT license](LICENSE). Third-party sources retain their own licensing and attribution.
