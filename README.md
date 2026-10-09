# ICARUS

A macOS programming companion for the code in front of you. Open a mode from the animated library and workspace, or select text in another app and press **⌘⇧Q**. Answers stream into a desktop panel with Copy, Retry, Stop, and follow-up questions.

The shortcut captures highlighted code into an editable, compact glass panel, asks what you are building, and lets you choose a mode before sending anything. Opening a mode from the landing page uses the same panel without entering fullscreen. Responses appear as soon as they stream; there is no artificial thinking delay.

Available modes: Hint Mode, Full Coach (Improve Logic on the main page), Explain My Mistake, Fix Code, Full Solve, Ask ICARUS, Explain Code, and Refactor. Project notes and recent answers stay in local storage. Connections support Hugging Face, OpenAI, Groq, OpenRouter, Google Gemini, Ollama, LM Studio, and other OpenAI-compatible APIs.

See [the implemented architecture](ARC.md), [product plans](PRO.md), and [design guidance](DESIGN.md). Product and design documents also contain future ideas; the architecture describes current behavior.

## Setup and launch

The desktop app requires macOS, Node.js/npm, Python 3.11 or newer, and Xcode Command Line Tools. The native build uses the active macOS SDK selected by `xcrun`. Verification used Node.js 24 and Python 3.14; other toolchain versions have not been verified.

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

New installations start with **None** and no model. Existing saved connections are preserved. In Model connection, paste a key and click **Discover models** to recognize supported key formats, or choose the provider yourself. Generic keys need an explicit provider; they are never tried against several services. Choose a discovered model or enter its ID, then use **Test & save connection**. A successful test displays the responding model and a short reply. Discovery alone does not select or save a model, and failed tests preserve your previous connection.

**Other API** accepts an HTTPS base URL for OpenAI-compatible `/models` and `/chat/completions` endpoints. Credentials are scoped to that base URL. Private network addresses, URL credentials, query strings, fragments, and nonstandard ports are rejected; redirects and environment proxies are disabled. If an API does not offer model discovery, enter the model ID manually. APIs using other protocols require a dedicated adapter.

Remote providers require a token; local servers must already be running. Saved tokens stay in macOS Keychain and are never returned to the renderer. Grant the selection helper Accessibility access in macOS settings to capture highlighted text, or paste code into the panel.

If macOS blocks a token created by an older native helper, paste the key again and test/save it. Readable older tokens remain usable; blocked entries are treated as missing without opening a password dialog. Removing a token can require access to its older Keychain entries.

Submitted code, explicitly selected project context, and follow-up exchanges go to the selected provider. Recognized secrets are redacted before remote requests, but redaction is best effort. The app displays AI output as text and does not execute generated code or automatically replace editor contents.

The Python service accepts authenticated request bodies up to 2 MiB and marks API responses `no-store`. Generation has a 120-second total deadline; connection probes have 15 seconds. Provider responses are limited to 1 MiB per line or connection-probe body and 8 MiB per stream. Partial answers survive an interrupted request. SQLite files are restricted to the current user before opening; project notes and history remain unencrypted local data.

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
node scripts/verify-popup.mjs
node scripts/verify-popup-native.mjs
```

The popup native check runs real Electron/IPC/Python with temporary storage, dummy credentials, and fixture selection/model responses. It does not press an OS shortcut or read real editor text. Additional scene and Home checks are under `frontend/scripts`. Other native QA scripts may use real desktop integration and should be reviewed before running against saved connections.

## Source and local files

`frontend/vendor/threeui` retains registered source bundles, manifests, original assets, and provenance. Preparation scripts validate these and create ICARUS derivatives; edit those scripts or React wrappers rather than generated HTML. Bundled Three.js licensing is retained under `frontend/public/vendor/three`.

Git excludes dependencies, generated builds, local databases, environment secrets, QA evidence, private working notes, cleanup backups, and submission presentations. These rules protect Git uploads; uploading the entire folder manually would include local-only files.

ICARUS uses the existing [MIT license](LICENSE). Third-party sources retain their own licensing and attribution.
