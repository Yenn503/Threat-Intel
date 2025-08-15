<div align="center">
  <h1>Threat‑Intel</h1>
  <p><strong>Operator console for offensive research & OSINT aggregation.</strong></p>
  <p>
    <a href="#quickstart">Quickstart</a> •
    <a href="#features">Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#roadmap">Roadmap</a> •
    <a href="#security">Security</a> •
    <a href="#contributing">Contributing</a> •
    <a href="#license">License</a>
  </p>
</div>

> Status: Early prototype (0.x). Expect breaking changes until 1.0.

---

## Overview
Threat‑Intel is a full‑stack TypeScript/JavaScript application that unifies exploit technique curation, a browser‑based terminal, OSINT framework navigation, breach intelligence lookups, and a lightweight code / PoC workspace.

The goal is to provide a streamlined research cockpit: enumerate, enrich, prototype, and operationalize – all in one interface.

## Features
Implemented (current milestone):
  Core & Platform
  - Auth (session token) & role concept placeholder
  - Dashboard metrics (mock / example wiring)
  - Exploit Techniques CRUD panel (templates + descriptions)
  - Embedded persistent web terminal (WS PTY bridge)
  - Code Editor (Monaco) with snapshots, diff viewer, snippets, formatting, run (JS/TS)
  - LocalStorage persistence (active panel, theme, editor files)
  Intelligence & Research
  - OSINT Framework tree (collapsible) + radial visualization mode (placeholder dataset)
  - Vuln Search panel (independent CVE keyword search; separated from FSWA)
  - First Stage Web Assessment (FSWA) panel: WHOIS, Shodan host lookup, WordPress plugin enumeration
  Data & Utilities
  - DB Search panel (HIBP style batch & rate pacing logic – backend stub)
  - Settings & Admin panels (system metrics, user list, config preview)
  UI / UX
  - Modular panel architecture (no router) with dynamic grouping & Assessments section
  - Themed sidebar with enlarged section headers & subtle underline separators
  - Custom themed scrollbar styling (dark/light adaptive)
  Scaffolding (placeholders ready for implementation)
  - Network VA panel
  - Digital Footprint panel
  - Cyber Risk Exposure panel

Planned / Backlog (updated):
  Data & Enrichment
  - Full upstream OSINT dataset integration & legend styling
  - CVE enrichment (EPSS, KEV, NVD severity caching)
  - DeHashed / additional breach sources abstraction layer
  Platform & Security
  - Auth hardening (refresh tokens, RBAC, MFA option)
  - API key management & user audit log
  - Export / import of techniques & editor files
  Assessments Expansion
  - Network VA implementation (host discovery, service enum, lightweight vuln mapping)
  - Digital Footprint enumeration (subdomains, CT logs, exposed assets)
  - Cyber Risk Exposure scoring (asset criticality + vuln likelihood model)
  - FSWA enhancements (tech fingerprinting, TLS/cert insights, screenshot capture)
  UX & Performance
  - Search/filter across OSINT tree & exploit techniques
  - Dark/light theme contrast & full accessibility pass 
  - Lazy loading / code splitting for heavier panels (editor, FSWA)
  - Keyboard command palette extensions & panel switch hotkeys

## Architecture
```
ExploitApp/
  backend/         Express API + WebSocket terminal + SQLite (better-sqlite3)
  frontend/        React 18 + Vite + Monaco + custom viz
  infrastructure/  Deployment & future IaC stubs (placeholder)
  README.md
  LICENSE
```

### Backend
- Node.js (ESM) Express server.
- SQLite (better-sqlite3) for quick local persistence.
- WebSocket endpoint for interactive shell proxy.
- Rate limiting middleware prepared for external APIs.
- Simple technique CRUD endpoints (extensible).

### Frontend
- Single page React app (no router yet – panel switching via state).
- Custom Monaco editor integration w/ multi-file, snapshots, diff modal.
- OSINT tree SVG renderer (collapsible) + radial canvas layout.
- Reusable toast / notification context.
- LocalStorage persistence for editor state & UI preferences.

### Security Posture (Prototype)
- No production hardening yet (TLS termination, CSP, strict headers partially via helmet).
- JWT auth placeholder – production should add refresh tokens & revocation.
- Web terminal is powerful: ensure upstream server enforces auth & sandboxing.

## Quickstart
Prereqs: Node.js >= 18, npm.

Clone & install:
```bash
git clone https://github.com/<your-org>/<your-repo>.git threat-intel
cd threat-intel

# Backend
cd backend
npm install
npm run dev &

# Frontend (in new shell)
cd ../frontend
npm install
npm run dev
```
Visit: http://localhost:5173

Default credentials (adjust in `.env`):
```
EMAIL=admin@example.com
PASSWORD=password
```

## Environment
Backend `.env` example:
```
PORT=4000
JWT_SECRET=change_me
HIBP_API_KEY=

# LLM (Gemini) Integration
# Obtain an API key: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=
# Optional: override model (default gemini-1.5-flash). Other examples: gemini-1.5-pro
GEMINI_MODEL=
```

Additional runtime environment variables (advanced):
```
# Agent Orchestrator
AGENT_DEADLOCK_MS=300000   # Milliseconds before a task with no runnable pending steps is marked deadlocked (default 300000 = 5m). Lower in tests.
AGENT_NON_DETERMINISTIC=1  # (Optional) Disable deterministic single-step scheduling in tests; by default tests run deterministically.
SCAN_FAKE_DELAY_MS=5       # Delay (ms) for simulated scans in test / no-real-scan mode. Tune to >0 to exercise async; keep small for speed.

# Target Safety
TARGET_ALLOWLIST=scanme.nmap.org,*.example.com  # If set, only listed hosts (or matching wildcard suffix) are permitted for scans/tools.
```

Health Endpoint (`/api/ai/health`) now returns:
```
{ ok: true, llm: boolean, allowlist: [...], deadlockTimeout: 300000, deterministicMode: true }
```

LLM notes:
- If `GEMINI_API_KEY` is unset the assistant falls back to a disabled notice and only basic agent actions work.
- All model prompts are single-turn compiled with a short recent chat window + scan context; no external memory store yet.
- Returned JSON command blocks (between >>>JSON / <<<JSON) are parsed and queued as scans when safe.

## Scripts
Backend:
```bash
npm run dev      # watch mode
npm start        # production start
npm test         # node test runner
npm run test:ci  # CI guarded deterministic run (fails if non-deterministic enabled)
npm run test:stability  # Executes suite multiple times (set STABILITY_LOOPS, default 3) to detect flakiness
npm run test:timing     # Outputs timing summary (set TIMING_LOOPS for multiple)
```
Frontend:
```bash
npm run dev      # Vite dev server
npm run build    # production build (dist/)
npm run preview  # preview production build
```

## Development Notes
- Monaco editor workers auto-configured; adjust Vite config if deploying under subpath.
- OSINT JSON currently a trimmed placeholder (`frontend/src/osint-arf.json`). Replace with full dataset for production.
- Radial view uses canvas for performance; tree uses SVG for crisp text & accessibility.

### Test Mode & Agent Execution

Backend test suite runs the AI agent and scan queue without real Nmap / Nuclei by injecting a fake scan executor.

Flags / Env:
- `NODE_ENV=test` enables fast agent loop interval (150ms) for rapid task progression.
- `DISABLE_AUTO_AGENT_LOOP=1` (set in tests) prevents the loop from auto‑starting so a test can inject a custom executor first.
- `ENABLE_LLM_TESTS=1` opt‑in to actually call the LLM during tests (default off to keep CI deterministic).

Injected Executor:
```js
import scanService from '../services/scanService.js';
scanService.setExecutor(async (task) => {
  Scans.markRunning(task.id);
  // Provide synthetic summary per scan type
  const summary = task.type==='nmap' ? { openPorts:[{ port:80, service:'http'}], openCount:1 } : { findings:[] };
  Scans.complete(task.id, 'FAKE_OUTPUT', summary, 10);
});
```
This pattern isolates queue mechanics from external binaries and keeps tests fast & hermetic.

Agent Tests Cover:
- Task lifecycle via shorthand instruction (`/api/ai/agent/tasks`).
- Manual plan execution (`/api/ai/agent/execute`).
- Basic step transition snapshots.
- Deterministic progression guarantees at most one step transition per explicit `runAgentOnce()` tick (enforced in tests). Use `AGENT_NON_DETERMINISTIC=1` to revert legacy batch behavior if debugging timing issues.

DB Isolation:
- Each test file calls an `isolateDb(label)` helper which swaps in a fresh in‑memory SQLite instance and seeds an admin user.
- This removes cross‑test state leakage (scan counts, tasks, rate limits) and underpins deterministic scan quota assertions.

When real scanners are available simply omit `setExecutor` and provide `NMAP_PATH` / `NUCLEI_PATH` in `.env`.

## Roadmap
| Milestone | Focus | Key Items |
|-----------|-------|-----------|
| 0.2 | Data Fidelity | Full OSINT data, search, legend, URL badges |
| 0.3 | Enrichment | CVE enrichment, DeHashed adapter, export/import |
| 0.4 | Security | RBAC, audit log, improved session lifecycle |
| 0.5 | UX Polish | Keyboard nav, theming API, accessibility pass |
| 1.0 | Stable | Documentation, test coverage >80%, release hardening |

## Contributing
1. Fork & branch from `main`.
2. Conventional commits (feat:, fix:, chore:, docs:, refactor:, test:).
3. Run tests & lint before PR.
4. Include screenshots / GIFs for substantial UI changes.

Suggested checks before PR:
```bash
backend: npm test
frontend: npm run build
```

## Security
Responsible disclosure: please open a private security advisory (GitHub Security tab) or email the maintainer rather than filing a public issue for vulnerabilities.

Hardening To‑Dos:
- Enforce HTTPS & secure cookies
- Add rate limiting per auth scope
- Shell isolation / namespace sandboxing
- Input validation & schema enforcement

## License
MIT License – see `LICENSE`.

## Attribution
- OSINT Framework (structure & inspiration) © Justin Nordine (MIT).
- Icons via `react-icons` (Feather set).

---
Happy Hunting.
