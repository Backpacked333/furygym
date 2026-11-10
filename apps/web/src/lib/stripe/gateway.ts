import type Stripe from "stripe";
import type { PaymentDetails, StripeGateway, SubscriptionInfo } from "./webhook";

const idOf = (value: unknown): string | null => (typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : null);

/** The live implementation of the webhook's calls back to Stripe. */
export function stripeGateway(stripe: Stripe): StripeGateway {
  return {
    async getSubscription(id): Promise<SubscriptionInfo> {
      const sub = await stripe.subscriptions.retrieve(id);
      // The billing period lives on the subscription items in current API versions.
      const periodEnds = sub.items.data.map((item) => item.current_period_end).filter((n): n is number => typeof n === "number");
      return {
        id: sub.id,
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_end: periodEnds.length ? Math.max(...periodEnds) : null,
        paused: Boolean(sub.pause_collection),
        resumes_at: sub.pause_collection?.resumes_at ?? null,
        ended_at: sub.ended_at,
        metadata: sub.metadata ?? {},
      };
    },

    async getPaymentDetails(paymentIntentId): Promise<PaymentDetails> {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
      const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
      const balance = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
      return {
        chargeId: charge?.id ?? idOf(intent.latest_charge),
        feeCents: balance ? balance.fee : null,
        balanceTransactionId: balance?.id ?? idOf(charge?.balance_transaction),
      };
    },

    async getInvoicePaymentIntentId(invoiceId): Promise<string | null> {
      const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 5 });
      const paid = payments.data.find((p) => p.status === "paid") ?? payments.data[0];
      return idOf(paid?.payment?.payment_intent);
    },
  };
}
