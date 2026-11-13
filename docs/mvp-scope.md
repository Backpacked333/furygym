# Scope: what this build covers

Single gym. The staff side on the web, the athlete side as a native iOS app, and the backend
between them. Framework Phase 1 (core pilot) and Phase 2 (commerce and online programs).

## Feature matrix

Status: **Built** = implemented and covered by automated tests. **Built, unverified** = implemented
but could not be exercised end to end here (says why). **Not built** = out of this build.

### A. Memberships, transactions and gym operations

| Capability | Status | Notes |
|---|---|---|
| Recurring memberships, intro offers, class packs, drop-ins | Built | Plans are edited in the console; no Stripe product setup needed |
| Online program purchases | Built | Web checkout; unlocks in the app |
| Coupons | Built, unverified | Stripe promotion codes are enabled at checkout; create the codes in Stripe. Needs live Stripe keys to try |
| Refunds | Built | Admin refunds from a member's page; a full refund takes back the pack or program |
| Class schedule, reservations, capacity, waitlist, cancellations | Built | Waitlist promotes automatically; late cancels keep the class credit |
| Attendance / check-in | Built | Athletes show a rotating QR code in the app; the front desk scans it at `/admin/checkin` (handheld scanner or camera). Staff can also check in from the roster |
| Digital waiver and consent record | Built | Typed-name signature with time, IP and device; re-sign on new version |
| Membership freeze and cancel | Built | Staff from the console; athletes from the app (freeze 2, 4 or 8 weeks, resume early, cancel at period end). A freeze pauses Stripe collection and releases bookings in the window |
| Failed-payment recovery | Built | Stripe retries and emails; membership shows past due and keeps access meanwhile |
| Receipts | Stripe | Stripe emails receipts once enabled in the Stripe dashboard |
| Taxes | Built, off by default | Set `STRIPE_AUTOMATIC_TAX=true` after configuring Stripe Tax |
| Payout reconciliation | Built | Payouts and per-payment fees recorded from Stripe |
| Notifications | Partial | Local class reminders on the phone. When the gym cancels a class, each booked athlete sees a notice on their Today screen and staff get the list with an "Email all" link that opens their own email. No email/SMS/push is sent by the server |
| Attendance milestone | Partial | The app counts check-ins toward a reward set in the console (Plans & settings; default every 20 visits). The dashboard lists who has earned it until staff mark it given; handing it over is manual |
| Referrals | Not built | |

### B. Coach programming and facility display

| Capability | Status | Notes |
|---|---|---|
| Workout builder with exercise library, movement notes, scaling, instruction video | Built | Video is a link per item or exercise |
| Coach-defined metrics per item | Built | Load, sets, reps, time, distance, pace, splits, RPE, benchmark, comments |
| Reusable templates | Built | |
| Training blocks / program calendars | Built | Week × day grid for online programs |
| Scheduled publishing | Built | Draft, publish now, or publish at a set gym time |
| TV / kiosk display with staff control | Built | Auto (today), one track, pinned workout, message banner, or off. Shows the current or next class, a countdown and how many are checked in; names are opt-in. Staff see whether a screen is connected. Setup and gym acceptance test: [tv-display.md](tv-display.md) |
| Strength, Engine and Selection tracks | Built | More tracks are rows, not code |

### C. Athlete profile and training experience (iOS)

| Capability | Status | Notes |
|---|---|---|
| Personal training calendar | Built | Gym workouts and program days together |
| Workout detail with video link | Built | |
| Logging with configurable fields | Built | Form generated from the coach's metrics; drafts kept on the device |
| History, PRs, benchmarks, adherence, charts | Built | |
| Coach feedback | Built | Coaches write it in the console; athletes read it in the app |
| Unified profile, purchase history, entitlements | Built | |
| Membership self-service | Built | Plan, renewal date, class credits, freeze, resume, cancel, billing portal |
| Add a booked class to the phone calendar | Built | Write-only calendar permission, asked on first use |
| In-app account deletion | Built | Required by the App Store; stops billing first |

The iOS screens compile and their unit tests run in CI on macOS. They have been used by hand in
the simulator, not on a physical phone — see "Not yet verified" below.

### D. On-demand online programs

| Capability | Status | Notes |
|---|---|---|
| Programs of any length in weeks | Built | |
| Own start date and generated calendar per enrollment | Built | |
| Unlock rules | Built | Weekly (default), daily, or all at once |
| Late starts, missed days, rescheduling, expiry, extensions | Built | See defaults below |

### F. Reporting

| Capability | Status | Notes |
|---|---|---|
| Revenue by stream; gross, tax, fees, refunds, net | Built | Facility and digital today; licensing, merchandise and events have no sales yet |
| Members, churn, attendance, failed payments | Built | |
| CSV export | Built | Payments, memberships, attendance. Exports read every row; the memberships export is all memberships, not a date range |
| Transaction list | Built | Newest 200 for the period, with Refunds and Failed filters applied before the cut; says when it is cut |
| Change log (audit) | Built | Admins and owners: who changed a role, membership, enrolment, plan, program or the display, and the before and after |
| Accounting integration | Not built | Export covers the pilot |

### Not in this build

E (gym licensing and other gyms), G (content hub and merchandise), H (competitions), I (AI),
Android, and migration of data out of Wodify.

## Rules chosen where the framework left them open

These are defaults, each a setting rather than hard-coded. Change them if they are wrong for the gym.

| Question | Default |
|---|---|
| Program start | Athlete picks any date from today to 90 days out at purchase, and can move it until the program begins. Staff can move it at any time |
| Unlocking | Each week opens on its first day |
| Missed days | Stay available; nothing is forced to be done in order |
| Access after the last week | 14 more days, then the workouts lock. Logged history stays visible forever |
| Extensions | Staff edit the access-until date |
| Booking window | 14 days ahead |
| Free cancellation | Until 60 minutes before class; after that a class credit is not returned |
| Waitlist | Free to join; the credit is taken only when a place is given |
| Past-due membership | Keeps access while Stripe retries; ends when Stripe cancels |
| PR definition | Heaviest load for an exercise at a given rep count; fastest time (else most reps) for a benchmark |

## Suggested pilot

1. Fury Co. coaches use the console for programming and the TV display alongside Wodify.
2. A small athlete group installs the app through TestFlight and logs training; staff add their
   memberships by hand ("carried over from Wodify"), so no payment moves yet.
3. One online program is sold for real through Stripe to prove checkout, calendars and reporting.
4. Only then move class booking and membership billing off Wodify.

## Design

Both clients follow the Fury design system supplied on 10 November 2026: true-black canvas, grouped
dark surfaces, red accent, track colours (Strength red, Engine orange, Selection indigo), pill
buttons and, on iOS, a floating tab bar with a check-in button.

Where the build differs from the mockups, and why:

| Mockup | Build |
|---|---|
| Card form and Apple Pay sheet inside the app | Stripe's hosted checkout in an in-app browser. Card data stays with Stripe; Apple Pay appears there once enabled in Stripe |
| Buying a program inside the app | Opens the website, US storefront only, and can be switched off — Apple's rule for digital goods |
| Drawn signature on the agreement | Typed full name, recorded with time, IP and device |
| Foundations / Scaled / Rx tiers | Rx and Scaled, from the scaling notes coaches already write |
| Freeze with a monthly hold fee and a yearly allowance | Free freeze of 2, 4 or 8 weeks, no allowance tracking |
| Program priced by duration (4, 8, 12 weeks) | One price per program |
| Checked-in names on the TV | Off by default; a switch in Display control |

Shown in the mockups and not built: Fury Hub content, referrals, reward fulfilment, the in-workout
timer, suggested coach replies, "message class", QuickBooks sync, pairing several displays, timer
and leaderboard display modes, and NFC check-in.

## Not yet verified

Said plainly, so nothing here is mistaken for done:

- **The iOS app has only been run in the simulator.** It was walked through there with separate
  owner, coach and athlete accounts, and the defects found were fixed. It has not been run on a
  physical phone or through TestFlight; expect layout and flow fixes in the first TestFlight round.
- **The check-in scanner has not read a real phone screen.** The code maths is tested on both
  sides (app and database agree); a camera or handheld scanner reading the app's QR code off a
  phone is still to try.
- **No real Stripe call has been made.** Checkout and the webhook are tested against constructed
  Stripe events and a fake Stripe client. The first live test-mode purchase is still to do.
- **The release lanes (fastlane) have never run** — they need Fury Co.'s Apple account.
- **Nothing is deployed.** No Supabase project, Vercel project or Stripe account was touched.
- **The waiver text is a placeholder** and must be replaced with counsel-approved wording.
