# Contributing to Threat‑Intel

## Quick Start
1. Fork the repo & clone your fork
2. Create a feature branch: `git checkout -b feat/short-description`
3. Install deps in both `backend/` and `frontend/`
4. Commit with conventional commits
5. Open a Pull Request (PR)

## Development Workflow
- Keep branches rebased on `main`
- Small, focused commits
- Add or update tests for logic changes
- Run lint/build before pushing (add a screenshot/GIF for major UI changes)

## Commit Message Format
```
<type>(optional scope): <short summary>

[body]
[footer]
```
Allowed types: feat, fix, docs, style, refactor, perf, test, chore, build, ci.

Examples:
```
feat(osint): add search box for tree nodes
fix(terminal): handle PTY resize race condition
```

## PR Guidelines
- Reference related issues (`Closes #123`)
- Provide context & reasoning
- Note any follow‑up tasks

## Testing
Add minimal reproducible tests. Future plan: >80% coverage prior to 1.0.

## Code Style
- Prefer explicit names
- Avoid premature optimization
- Keep functions < ~60 lines when possible

## Security
Never commit secrets. Use `.env` and supply sample keys in `.env.example` only.

## License
By contributing you agree your contributions are licensed under the MIT License.
