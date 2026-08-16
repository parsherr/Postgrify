# Contributing to Postgrify

Thanks for taking the time to contribute. This document covers everything you need to get started.

---

## Table of Contents

- [Project structure](#project-structure)
- [Development setup](#development-setup)
- [Making changes](#making-changes)
- [Code standards](#code-standards)
- [Tests](#tests)
- [Submitting a pull request](#submitting-a-pull-request)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)

---

## Project structure

```
postgrify/
├── packages/
│   ├── api/        # Fastify + TypeScript REST API
│   ├── gui/        # React + Vite + Tailwind CSS frontend
│   └── auth-js/    # @postgrify/auth-js zero-dependency SDK
├── docs/
└── docker-compose.yml
```

Each package is independent. Changes to the API do not require rebuilding the GUI, and vice versa.

---

## Development setup

**Requirements:** Node.js 18+, Docker, git.

```bash
git clone https://github.com/parsherr/postgrify.git
cd postgrify
```

Copy the environment template and fill in the required values:

```bash
cp packages/.env.example packages/.env
```

Mandatory variables: `PG_PASSWORD`, `JWT_SECRET` (32+ chars), `ADMIN_SECRET` (16+ chars). See [`exampleenv.md`](exampleenv.md) for all options.

### Running the full stack (recommended)

```bash
cd packages
docker compose up -d --build
```

GUI → http://localhost:5173 · API → http://localhost:3000 · API docs → http://localhost:3000/api-docs

### Running packages individually

```bash
# API (hot reload)
cd packages/api && npm install && npm run dev

# GUI
cd packages/gui && npm install && npm run dev

# auth-js SDK
cd packages/auth-js && npm install && npm run build
```

---

## Making changes

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/describe-your-change
   ```
   Use a prefix: `fix/`, `feat/`, `docs/`, `refactor/`, `test/`.

2. Make your changes. Keep each commit focused on one thing.

3. Run tests and typecheck before pushing:
   ```bash
   cd packages/api
   npm run typecheck
   npm test
   npm run lint
   ```

4. Open a pull request against `main`.

---

## Code standards

These are enforced in review — not just style preferences.

- **One thing per function.** If you need "and" to describe it, split it.
- **No magic numbers or strings.** Extract named constants.
- **Fail loudly.** Descriptive errors, no silent catches. If you swallow an error, leave a comment explaining why.
- **Files under ~300 lines.** If a file is growing, find its natural seam and split it.
- **No side effects in utilities.** Side effects (DB writes, network calls) belong in route handlers or service entry points.
- **New routes need tests.** See `test/routes/rows.test.ts` for the canonical pattern — minimal Fastify instance with mocked decorators, no real DB required.
- **All user-supplied identifiers go through `utils/identifier.ts`.** Never interpolate table/column/DB names into SQL directly.

Match the style of the file you're editing — comment density, naming conventions, error handling patterns.

---

## Tests

Tests use Vitest and do not require a running database.

```bash
cd packages/api

npm test                          # run all tests
npm run test:watch                # watch mode
npm run test:coverage             # coverage report

npx vitest run test/routes/tables.test.ts   # single file
```

Every new route or service should have a corresponding test file under `test/` mirroring the `src/` layout.

---

## Submitting a pull request

- Keep PRs small and focused. One feature or fix per PR.
- Write a clear description: what changed, why, and how to test it.
- If your PR fixes a bug, include a test that would have caught it.
- If your PR adds a new endpoint, update `endpoints.md`.
- PRs that break existing tests will not be merged.

---

## Reporting bugs

Open an issue and include:

- What you did (steps to reproduce)
- What you expected to happen
- What actually happened
- Your environment: OS, Node version, Docker version
- Relevant logs (`docker logs packages-api-1` or `npm run dev` output)

---

## Requesting features

Open an issue describing the problem you're trying to solve, not just the solution you have in mind. If the feature fits the project direction, we'll discuss the approach before any code is written.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).