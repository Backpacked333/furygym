# Architecture

## Shape

```
 iOS app (SwiftUI) ───────────────┐
                                  ├──►  Supabase: Postgres + auth + row-level security
 Web console (Next.js on Vercel) ─┘            ▲
        │                                      │ service role (webhook only)
        └── /api/stripe/* ◄──── Stripe ────────┘
```

- **One database, two clients.** Both the app and the console read and write Supabase directly as
  the signed-in user. What each person can see is decided by row-level security in Postgres, not by
  the clients.
- **Rules live in the database.** Booking a class, cancelling, check-in, building an athlete's
  calendar, submitting a workout log and signing a waiver are Postgres functions. The iOS app and
  the web console call the same function, so they cannot drift apart.
- **Deadlock recovery retries the whole database request.** Membership changes and seat changes
  can acquire row locks in opposite order. The web and native clients retry PostgREST's confirmed
  `40P01` rollback up to twice with jittered backoff, preserving credit accounting and waitlist order.
  This recovers deadlock victims rather than eliminating lock cycles; sustained contention can
  still exhaust the retry limit. Other SQL errors, ambiguous network failures, and Stripe calls
  are not replayed by this mechanism. New database clients need the same transaction-boundary policy.
- **Stripe is the only payment system.** The web app creates checkout sessions and receives Stripe's
  webhook. The webhook is the single writer of paid memberships, enrollments and payment records.

## Build versus integrate

| Area | Decision | Why |
|---|---|---|
| Programming, logging, calendars, booking | Built | This is the product and the reason to leave Wodify |
| Auth, database, API | Supabase | Managed Postgres with auth and per-row access rules; standard SQL, exportable at any time |
| Payments, subscriptions, receipts, card retries, tax | Stripe | Card data never touches our systems; failed-payment recovery and receipts come built in |
| Billing self-service (update card, invoices) | Stripe customer portal | No custom billing screens to maintain |
| Web hosting | Vercel | Zero-ops hosting for Next.js |
| Instruction video | Links (YouTube or any host) | No video pipeline to run in the pilot |
| Waiver signing | Built: typed name + timestamp + IP + device | Enough for a gym waiver; swap for an e-signature vendor if counsel requires |
| Accounting, merchandise | Not integrated yet | CSV export covers the pilot; QuickBooks and Shopify are later phases |

## Roles and data isolation

| Role | Can |
|---|---|
| Athlete | Own profile, memberships, bookings, calendar, logs, purchases |
| Coach | All of the gym's programming and classes; members' training and attendance. No financials, no role changes |
| Admin | Everything in the gym, including members, plans, payments and reports |
| Owner | As admin, and the only role that can create or change another owner |

Every business table carries a `gym_id`. The pilot has one gym, but nothing assumes it: adding a
second gym is new rows, not a new schema. Athletes are one identity across gym membership and online
programs.

Specific protections, each covered by a test:

- Athletes cannot see unpublished or not-yet-due workouts, or locked program weeks — the content is
  withheld by the database, not just hidden in the app.
- Bookings, memberships, enrollments and payments cannot be written by clients. Athletes act through
  functions that check the rules; money tables are written only by the Stripe webhook.
- The TV display reads through a secret token and exposes only workout content, the next class
  and a checked-in count. Athletes' first names appear only if staff switch that on.
- The check-in QR code changes every 30 seconds. It is derived on the phone from a per-athlete
  secret that only that athlete can read, and verified in the database, so a screenshot stops
  working within about a minute.
- Athletes change their own membership (freeze, resume, cancel) through one server endpoint that
  updates Stripe first and the database second, so billing and access cannot disagree.
- Role, membership, enrollment, plan and program changes are written to an audit log.

## Payments and the App Store

- **Gym memberships, class packs and drop-ins** are services delivered in person. Apple allows these
  to be sold with a normal card payment, so the app opens Stripe Checkout in an in-app browser.
- **Online programs** are digital content. Apple's rules require in-app purchase for digital goods
  sold inside an app, with an exception that lets apps on the US storefront link out to a web
  purchase. So: programs are bought on the website; the app shows what the athlete owns; and the
  "view on website" link appears only on the US storefront and can be switched off from the console
  (Plans & settings) without an app update. If Fury Co. later wants in-app purchase, entitlements
  are already separate from how they were paid for.
- Stripe fees are recorded per payment from Stripe's own balance records, so reports show gross,
  tax, fees, refunds and net separately rather than assuming fees.

This is a product reading of Apple's guidelines, not legal advice. The rules for external purchase
links have changed several times; confirm the current position before submission.

## Dates and time zones

Workout dates, program start dates and expiry dates are calendar days on the gym's clock. They are
stored as dates, compared in the gym's timezone on the server, and handled in the app by a
timezone-free date type — so an athlete travelling sees the same training day as the gym.

## Deferred, by design

Server-sent push notifications (the app schedules local class reminders), Sign in with Apple,
Android, QuickBooks, Shopify, AI features, the competition module, and everything about licensing
to other gyms.
