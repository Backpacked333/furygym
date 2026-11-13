# Ship plan: what is needed to deliver Fury Co. Athletics to the client

This is the single list of everything that stands between the current code and a client who is
using it. It says who has to supply each thing, in what order the work happens, and how we know
each step worked. Technical detail for each step is in `docs/launch-checklist.md`; this document
is the plan around it.

## 1. Where things stand

| Area | State |
|---|---|
| Code | Staff web console, athlete iOS app and database are built. Two pull requests (#4 TV display, #5 reports, waivers, change log, deployment basics) are open and not merged into `main`. |
| Automated tests | Database, web, browser and iOS unit tests pass locally and in CI. CI also sets up a gym from an empty database (no demo data), which is how production starts. |
| Hosting | Nothing exists. No production database, no website, no domain. Provisioning is paused by decision. |
| Payments | Never run against Stripe, not even in test mode. Code paths are covered by simulated webhook tests only. |
| Email | Sign-up confirmation and password reset work against a local mail catcher. No real email provider is connected. |
| iOS app | Runs in the simulator. Never installed on a real phone, never uploaded to TestFlight. |
| Hardware | Not tested on a real TV, a handheld QR scanner, or the gym's network. |
| Legal text | The waiver is a placeholder. There is no privacy policy, terms page or support contact. |

Nothing in this table can be called production-ready until the acceptance tests in section 6 pass
on the real deployment.

## 2. What the client is getting

Included (already built):

- Memberships, intro offers, class packs and drop-ins; card payment, refunds, freeze, cancel, failed-payment handling.
- Class schedule, booking, capacity, waitlist, late-cancel rules, QR and roster check-in.
- Digital waiver with signature records and re-signing when the text changes.
- Coach workout builder, exercise library, training tracks, scheduled publishing.
- Gym TV display.
- Athlete iOS app: calendar, workout logging, history, personal records, class booking, membership self-service, account deletion.
- Online programs sold on the website and followed in the app.
- Revenue, membership and attendance reports with CSV export; a change log of staff actions.

Not included, and not planned at the current price: gym licensing and multi-gym management, a
central content hub, merchandise, competitions, AI features, an Android app, Wodify
synchronisation, workout timers, push/SMS/email notifications sent by the app, NFC check-in, and
separately controlled screens per room. See `docs/mvp-scope.md` for the line-by-line map.

Things the client should know before signing off:

- All TVs show the same content.
- Attendance and bookings are this app's own. Nothing is read from or written to Wodify.
- The exercise library and class schedule start empty; staff enter them (section 5, step 5).
- Emails to members come from Supabase (confirmation, password reset) and Stripe (receipts, failed-payment notices). The app sends no other email.

## 3. What I need from you (Backpacked)

| # | Needed | Why |
|---|---|---|
| 1 | Go-ahead to merge PR #4 then PR #5 into `main` | Production should deploy from `main`. |
| 2 | Go-ahead to create the production Supabase and Vercel projects | Provisioning is paused. Quoted earlier: about US$10/month more on the existing Supabase organisation; the existing Vercel plan covers the project, usage is metered. |
| 3 | Who owns the accounts long term | Either the client owns Supabase, Vercel, Stripe and Apple from day one, or Backpacked hosts and bills. Transferring later is possible but is extra work, and an App Store listing is tied to the Apple account that publishes it. |
| 4 | Whether a staging copy is wanted | A second database and preview site for testing changes safely. Roughly doubles the database cost. |
| 5 | Support terms | Who the client calls, response times, and what is charged after handover. |
| 6 | Access to a Mac with Xcode signed in to the Apple team, or the App Store Connect API key | The TestFlight upload has to be signed by the client's Apple team. |

## 4. What I need from the client

### Accounts and access

| # | Needed | Notes |
|---|---|---|
| 1 | Stripe account for the legal entity that takes the money | Business details and bank account verified by Stripe. We need the test-mode secret key first, the live key only after test mode passes. |
| 2 | Apple Developer Program membership in the business's name | Paid yearly to Apple. Organisation enrolment needs a D-U-N-S number and can take days to weeks. Start this first; it is the slowest item. |
| 3 | A domain or subdomain for the website, and access to its DNS | For example `app.furyco.com`. Also needed to verify the email sender. |
| 4 | An email sending service (SMTP) on that domain | Any transactional provider. Without it, confirmation and reset emails will not reliably arrive. |
| 5 | Email address of the first owner | That account is promoted to owner by hand once (section 5, step 4). The owner then assigns admins and coaches in the console. |

### Decisions

| # | Decision | Default if nobody decides |
|---|---|---|
| 1 | Gym name and timezone | "Fury Co. Athletics", America/Chicago |
| 2 | Waiver and membership agreement text, approved by their lawyer | None. Until a waiver is published, athletes can book without signing anything. |
| 3 | Plans and prices: memberships, intro offer, class packs, drop-in, online programs | None; there is nothing to buy until plans exist. |
| 4 | Booking rules: how far ahead booking opens, free-cancellation cutoff | 14 days ahead, 60 minutes before class |
| 5 | Freeze and cancellation policy wording | Athletes can freeze for 2 weeks, 1 month or 2 months in the app; staff can set any end date 1 to 13 weeks ahead. Cancelling takes effect at the end of the paid period. |
| 6 | Whether sales tax is collected | Off |
| 7 | Whether the app shows a link to buy programs on the website | On, US App Store only. Apple may object; it can be switched off in settings without a new build. |
| 8 | Wodify: keep it for billing and bookings during a pilot, or move everything | Not decided. Running both for the same job means staff keep two systems in step by hand. |
| 9 | Privacy policy, terms, and a support email or page | Required by Apple before the app can be offered outside the internal test group. I add the pages once the text exists. |

### Content and equipment

- Logo and app icon artwork, brand colours.
- App Store text and screenshots (I can produce screenshots from the app).
- The class timetable, coach names and emails, and the movement list for the exercise library.
- If moving off Wodify: an export of members and memberships. Saved cards cannot be copied across; members re-enter a card, or Wodify's processor migrates them to Stripe on request.
- Per TV: a small computer or stick that runs a current Chrome, wired or reliable Wi-Fi. See `docs/tv-display.md`.
- For check-in: a tablet or laptop at the front desk. A USB or Bluetooth QR scanner or typing the code works in any browser. Scanning with the device camera depends on the browser and has not been tried on real hardware.

## 5. Deployment, in order

Each step lists what proves it worked. Nothing here has been done.

| # | Step | Depends on | Proof |
|---|---|---|---|
| 1 | Merge PR #4, then PR #5, into `main` | Your go-ahead | CI green on `main` |
| 2 | Create the production Supabase project; push the migrations. Never run `supabase/seed.sql`: it creates demo accounts with a published password. | Your go-ahead | Tables exist; one gym row; no users |
| 3 | Auth settings: email confirmation on, site URL and `/auth/callback` redirect set to the real domain, SMTP connected, the two email templates from `supabase/templates` installed | Domain, SMTP | A real inbox receives the confirmation and reset emails and the links work |
| 4 | Create the Vercel project (root directory `apps/web`, Node 22), set the four Supabase/site variables, attach the domain | Step 2, domain | `/api/health` answers `{"status":"ok","database":"ok","payments":"off"}` |
| 5 | Owner signs up on the site and is promoted to owner with one SQL statement. Owner then sets gym name and timezone, publishes the waiver, creates plans, adds coaches, the timetable and the exercise library. | Steps 3 and 4, client decisions | Owner sees the console; a second test account sees only the athlete page |
| 6 | Stripe test mode: add the test keys and the webhook endpoint, then buy a membership, a class pack and a program, fail a renewal, refund one | Stripe account | Each shows correctly on the member's page and in Reports; no unprocessed rows in `stripe_events` |
| 7 | iOS: fill in the production settings, run on a real iPhone, upload to TestFlight | Apple account, steps 3 to 5 | Staff install from TestFlight and complete the athlete checks in section 6 |
| 8 | Gym hardware: set up each TV and the check-in device on the gym network | Step 5 | The acceptance list in `docs/tv-display.md`, including unplugging the network and a power cycle |
| 9 | Monitoring and backups: uptime monitor on `/api/health`, Supabase daily backups confirmed, one test restore | Step 4 | An alert arrives when the check is made to fail; the restore is readable |
| 10 | Pilot with staff and a small group of members | Steps 1 to 9 | Section 6 passes on production |
| 11 | Stripe live mode: swap in live keys and the live webhook secret | Step 6 passed, pilot clean | One real purchase and refund by the owner |
| 12 | App Store submission | Privacy policy and support URLs, step 10 | Approved build |
| 13 | Handover (section 7) | All above | Client signs off |

Variables to set, with where they come from:

| Variable | Where | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, server only | Supabase project settings. Full database access: never in the app, a preview site, or chat. |
| `NEXT_PUBLIC_SITE_URL` | Vercel | The production domain, with https |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Vercel, server only | Stripe. Leave unset until step 6; the app shows payments as off. |
| `STRIPE_AUTOMATIC_TAX` | Vercel | `true` only if Stripe Tax is set up |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_BASE_URL`, `DEVELOPMENT_TEAM`, `APP_BUNDLE_ID` | iOS build settings | Same Supabase project, the production domain, the Apple team |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | Build machine only | App Store Connect API key |

There are no scheduled jobs to set up. Membership expiry, freezes ending and booking windows are
worked out from the date whenever they are read, so nothing has to run overnight.

## 6. Acceptance tests on production

Run these on the real site and a real phone before the client is told it is ready. Each has an
automated equivalent that passes locally; that does not replace running it here.

Accounts and access
- Sign up, receive the confirmation email, confirm on a different device, sign in.
- Signing in before confirming says to confirm first.
- Reset a password from the delivered email; old password stops working.
- Athlete cannot open any console page. Coach cannot see Reports, Memberships, Plans or Activity, and cannot change roles. Admin cannot make an owner.
- Two athletes on one phone, one after the other: neither sees the other's draft or history.
- Delete an account from the app; the person disappears from rosters and their waitlist place is released.

Waiver
- New athlete is asked to sign before buying or booking. Publish a new version; the same athlete is asked again.

Money (test mode first, then one live purchase)
- Buy a membership, a class pack and a program. Each appears on the member's page and in Reports.
- Failed renewal shows as past due and recovers when the card is fixed.
- Refund in full and in part; totals in Reports match Stripe.
- Freeze, unfreeze and cancel from the app and from the console; the change log names who did it.

Classes
- Fill a class, join the waitlist, cancel a place: the first waiter is promoted.
- Cancel a class-pack booking after the free-cancellation cutoff: the credit stays used. Before the cutoff: the credit is returned.
- Staff cancel a class: everyone is released and credits come back.
- Check in by scanner, by typing the code and, where the browser supports it, by camera; a second scan says the athlete is already checked in.

Training
- Publish a workout: it appears on the TV within 30 seconds and in the app. A scheduled workout does not appear early.
- Log a workout in the app, edit it, see history and a personal record.
- Buy a program, start it, and see only that program's workouts on the right days.

Reports
- Revenue totals match Stripe for a chosen period. CSV exports open in a spreadsheet with every row.

Operations
- `/api/health` is monitored and alerts.
- TV: network unplugged shows "Offline" and recovers; power cycle returns to the display; replacing the link blanks the old screen.

## 7. Handover

What the client receives:

- Owner login, and a short written guide for owner, admin and coach covering the daily jobs.
- TV setup and troubleshooting sheet (`docs/tv-display.md`), and a paper fallback for the workout.
- Where things live: domain, Supabase, Vercel, Stripe, Apple, email provider, with the client's own logins. No shared passwords; each person has their own account with two-factor on.
- What to do when something breaks: check `/api/health`, who to contact, how a database restore is requested.
- The known limits from section 2.

What I still do at handover: remove my own access or reduce it to what the support terms need,
rotate any key that was shared during setup, and confirm backups ran.

## 8. Risks worth deciding on now

- **Apple enrolment time.** Often the longest wait. Starting it today costs nothing.
- **App Review and program purchases.** The app links to the website to buy online programs. If Apple rejects that, the link is switched off and programs are bought on the website only. Selling them inside the app would need Apple in-app purchase, which is new work and gives Apple a commission.
- **Two systems.** If Wodify keeps doing bookings and billing, this app's attendance, TV check-in count and reports will be incomplete. Decide which system owns each job before the pilot.
- **Waiver.** Going live with the placeholder text, or with none, is the client's legal exposure. Do not open sign-ups until the approved text is published.
- **First real payments.** The payment code has only been tested with simulated Stripe events. Budget time in step 6 for fixes.
- **One person's phone.** The iOS app has not been on a real device. Expect small layout or keyboard issues on the first TestFlight build.
