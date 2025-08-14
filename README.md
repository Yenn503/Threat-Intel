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
- Auth (session token) & role concept placeholder
- Dashboard metrics (mock / example wiring)
- Exploit Techniques CRUD panel (templates + descriptions)
- Embedded persistent web terminal (WS PTY bridge)
- Code Editor (Monaco) with snapshots, diff viewer, snippets, formatting, run (JS/TS)
- OSINT Framework tree (collapsible) + radial visualization mode (local JSON placeholder)
- DB Search panel (HIBP style batch & rate pacing logic – backend stub)
- Vuln Search (placeholder wiring for CVE lookups)
- Settings & Admin panels (system metrics, user list, config preview)

Planned / Backlog:
- Full upstream OSINT dataset integration & legend styling
- Search/filter across OSINT tree & exploit techniques
- Auth hardening (JWT refresh, RBAC, MFA option)
- API key management & user audit log
- DeHashed / additional breach sources abstraction layer
- CVE enrichment (EPSS, KEV, NVD severity caching)
- Export / import of techniques & editor files
- Dark/light theme refinements & accessibility improvements

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
```

## Scripts
Backend:
```bash
npm run dev      # watch mode
npm start        # production start
npm test         # node test runner
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
