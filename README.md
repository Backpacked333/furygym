# Fury Co. Athletics platform

The operating system for one gym: a staff console on the web, a native iOS app for athletes, and
the backend that connects them. This is the core pilot plus commerce — single gym, no licensing to
other gyms yet.

| Part | Where | What it is |
|---|---|---|
| Backend | `supabase/` | Postgres schema, access rules, business functions, seed data, tests |
| Staff console & web | `apps/web/` | Next.js: programming, classes, members, plans, TV display, reports, checkout |
| Athlete app | `apps/ios/` | SwiftUI: calendar, workout logging, class booking, progress, membership |
| Docs | `docs/` | [Architecture](docs/architecture.md) · [Scope](docs/mvp-scope.md) · [Launch checklist](docs/launch-checklist.md) |

## Run it locally

Needs Node 22, pnpm and Docker.

```bash
pnpm install
```

```bash
pnpm db:start
```

`db:start` runs Postgres, auth and the API in Docker and applies every migration and the demo seed.
Then give the web app its connection details — copy `apps/web/.env.example` to
`apps/web/.env.local` and fill in the URL and keys printed by:

```bash
pnpm exec supabase status
```

```bash
pnpm web:dev
```

Open http://localhost:3000 and sign in with a demo account (password `FuryDemo123!`, local only):

| Email | Role |
|---|---|
| `owner@furyco.test` | Owner — everything, including money and settings |
| `coach@furyco.test` | Coach — programming, classes, members' training |
| `alex@furyco.test` | Athlete with an unlimited membership and an online program |
| `sam@furyco.test` | Athlete on a 10-class pack |
| `jordan@furyco.test` | New athlete: no membership, waiver unsigned |

The gym TV display for the demo data is at http://localhost:3000/display/demo-display-token.

Payments stay switched off until Stripe keys are added to `.env.local`; buying then explains that
online payment is not available rather than failing.

## The iOS app

Needs a Mac with Xcode 16.3 or later.

```bash
brew install xcodegen
```

```bash
cd apps/ios && cp Config/Config.example.xcconfig Config/Config.xcconfig && xcodegen && open FuryCo.xcodeproj
```

Fill in `Config/Config.xcconfig` first (Supabase URL and anon key, web app URL, your Apple team).
To use the local stack from the simulator, use the `127.0.0.1` values at the bottom of that file.
`FuryCo.xcodeproj` is generated from `project.yml`; re-run `xcodegen` after adding files.

## Tests

| Command | Covers |
|---|---|
| `pnpm db:test` | Access rules per role, booking and waitlist (including races), program calendars, logging and PRs, display, reports |
| `pnpm web:test` | Stripe webhook against the real database with a fake Stripe, checkout building, time zones, CSV |
| `pnpm web:e2e` | Browser tests: coach publishes → display and athlete see it; check-in; reports; signup and waiver |
| `swift test --package-path apps/ios/Packages/FuryCore` | iOS rules and models, decoded from responses captured from the real backend |

The browser tests assume freshly seeded data: run `pnpm db:reset` first. GitHub Actions runs all of
these, and builds and tests the iOS app on macOS, on every push that touches the relevant part.

After changing the schema, regenerate the web types and the iOS fixtures:

```bash
pnpm exec supabase gen types typescript --local > apps/web/src/lib/database.types.ts
```

```bash
pnpm db:reset && node apps/ios/scripts/refresh-fixtures.mjs
```
