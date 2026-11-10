# Launch checklist

Nothing below has been done yet: this build created no accounts and deployed nothing. Steps are in
the order they depend on each other.

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
3. In Authentication settings: turn on email confirmation, set the site URL to the web app's URL,
   and add `furyco://auth-callback` to the redirect URLs. Configure a real email sender (SMTP).
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
