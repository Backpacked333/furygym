# Launch checklist

Nothing below has been done yet: this build created no accounts and deployed nothing. Steps are in
the order they depend on each other.

For who has to supply what, the acceptance tests and the handover, see `docs/ship-plan.md`.

## 1. Backend (Supabase)

1. Create a Supabase project for production (a second one for staging is worth having).
2. Link and push the schema from the repo root:

   ```bash
   pnpm exec supabase link --project-ref YOUR_PROJECT_REF
   ```

   ```bash
   pnpm exec supabase db push
   ```

   Do **not** run the seed against production — it creates demo accounts with a published password.
3. In Authentication settings: turn on email confirmation, set the site URL to the web app's HTTPS URL,
   and allow `https://YOUR_DOMAIN/auth/callback` as a redirect URL. Configure a real email sender (SMTP).
   Install `supabase/templates/confirmation.html` and `supabase/templates/recovery.html` as the
   Confirm signup and Reset password templates. Their `/auth/confirm` links work across browsers
   and devices, including accounts created in the native app. The default PKCE template also works
   for web recovery through `/auth/callback`, but requires the browser that requested the email.
   Native password recovery opens the web flow; use the new password to sign back into the app.
4. Create the first owner: sign up through the web app, then run in the SQL editor:

   ```sql
   update public.gym_members set role = 'owner'
   where user_id = (select id from auth.users where email = 'owner@example.com');
   ```
5. In the console → Plans & settings: set the gym's timezone, replace the placeholder waiver with
   the approved text, and create the real membership plans.
6. Enable Supabase's automated backups and note the recovery procedure.

## 2. Web app (Vercel)

1. Create a Vercel project from this repository with root directory `apps/web`.
2. Set the environment variables from `apps/web/.env.example`. `SUPABASE_SERVICE_ROLE_KEY` and the
   Stripe keys are server-only secrets.
3. Point the production domain at it and set `NEXT_PUBLIC_SITE_URL` to that domain.
4. Use Node 22, matching CI. Keep preview and production databases and auth URLs separate; never
   give a public preview the production service-role key or load demo data into production.
5. Verify signup confirmation and password recovery using the actual delivered emails, including
   a second browser, invalid/used links, and sign-in with the new password. An anonymous request
   to `/admin` must redirect to sign-in; an athlete must never see staff/financial pages.
6. Open `https://YOUR_DOMAIN/api/health`. It must answer `{"status":"ok","database":"ok",...}`;
   `"payments":"off"` until both Stripe secrets are set. Point an uptime monitor at it: it
   answers 503 when the database cannot be reached or a required variable is missing.

## 3. Payments (Stripe)

1. Decide which legal entity owns the Stripe account; payouts go to its bank account.
2. Add a webhook endpoint at `https://YOUR_DOMAIN/api/stripe/webhook` for these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `charge.succeeded`, `charge.updated`, `charge.refunded`, `payout.created`, `payout.updated`,
   `payout.paid`, `payout.failed`.
3. Put the secret key and the webhook signing secret into Vercel.
4. In Stripe: enable the customer portal, email receipts, and failed-payment retries and emails.
5. **Test in Stripe test mode first**: buy a membership, a class pack and a program; let a
   subscription payment fail (card `4000 0000 0000 0341`); refund one. Check each shows correctly
   in the console and in Reports. This has not been done yet.
6. If sales tax applies, set up Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`.

### Webhook reconciliation

- A refund whose payment has not arrived returns HTTP 503 so Stripe retries it. Its `stripe_events`
  row keeps `processed_at = null` and a dependency message in `error`. Monitor unresolved rows;
  do not enable live billing until test-mode checkout/invoice/refund reordering is verified.
- After resolving a missing checkout/invoice, resend the refund from Stripe's event dashboard.
  Replays are idempotent and cannot reduce an already-recorded cumulative refund.
- Duplicate program payments are labeled for staff refund review. Refunding that duplicate does
  not revoke the original enrollment; only the checkout that granted access can revoke it.
- For legacy events already acknowledged incorrectly, compare the payment with Stripe first,
  then have an authorized operator clear only that reviewed event's `processed_at` and resend it.
  Never bulk-clear processed events or edit refund totals downward.

### Booking lifecycle policy

Cancelling a class releases booked/waitlisted reservations and returns unused debits once.
Already-attended and no-show history is retained, not silently converted into a refund. Increasing
capacity serves eligible existing waiters first. Inactive members lose new access and future
reservations, but retain their own logged history. A non-renewing pass is not a subscription:
its credits and existing expiry are unchanged by a renewal-cancellation request.

## 4. iOS app (Apple)

1. Enrol the business in the Apple Developer Program (the account that will own the app listing).
2. Register the bundle ID (default `com.furyco.athletics`) and create the app in App Store Connect.
3. Create an App Store Connect API key (App Manager role).
4. On a Mac: fill in `apps/ios/Config/Config.xcconfig`, run `xcodegen`, and run the app on a
   device against the production backend. Walk every screen — this has not been done yet.
5. Replace the placeholder icon (`apps/ios/scripts/make-icon.py` shows where it lives) and theme
   colours (`apps/ios/FuryCo/Design/Theme.swift`, `apps/web/src/app/globals.css`).
6. Upload a build to TestFlight:

   ```bash
   cd apps/ios && bundle exec fastlane beta
   ```

   The lanes read their settings from environment variables listed at the top of
   `apps/ios/fastlane/Fastfile`. They are untested; expect to adjust signing on the first run.
7. App Store Connect listing: screenshots, description, support URL, privacy policy URL, and the
   App Privacy answers (match `PrivacyInfo.xcprivacy`: name, email, phone, fitness, purchase
   history, user ID — linked to the user, not used for tracking).
8. For App Review, provide a demo athlete account that has a membership and a program, and note:
   - Memberships and class packs are for in-person services at the gym, paid by card.
   - Online programs are purchased on the website; the app does not sell digital content.
   - Account deletion is at Account → Delete account.

### App Review risk to decide on

The link from the app to buy programs on the web is shown only on the US storefront. If review
objects, switch it off in the console (Plans & settings → "buy on the web" link) — no new build
needed. The alternative is selling programs through Apple in-app purchase, which costs Apple's
commission and needs additional development.

## 5. Before moving members off Wodify

- Export members, memberships and history from Wodify and plan how they map across. Stored cards
  cannot be copied; members re-enter a card, or Wodify's processor performs a token migration to
  Stripe (ask both for their process and timeline).
- Run the pilot in `docs/mvp-scope.md` first.
