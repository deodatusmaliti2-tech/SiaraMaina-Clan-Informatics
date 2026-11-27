import Stripe from "stripe";
import { Request, Response } from "express";
import { dbEngine } from "./db";
import dotenv from "dotenv";

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" as any }) : null;

/**
 * Server-side Stripe Checkout Session Creator
 * Calculates prices authoritatively on the server.
 */
export async function createCheckoutSession(req: Request, res: Response) {
  try {
    if (!stripe) {
      return res.status(400).json({ error: "Stripe is not configured in the server environment." });
    }

    const { planType, userEmail, userId } = req.body;

    // Define pricing tier mapping strictly on the server to prevent front-end spoofing
    let priceCents = 0;
    let description = "";

    if (planType === "patron") {
      priceCents = 2500; // $25.00
      description = "SiaraMaina Clan Patron Contribution";
    } else if (planType === "sponsor") {
      priceCents = 10000; // $100.00
      description = "SiaraMaina Clan Golden Sponsor";
    } else {
      priceCents = 500; // $5.00 Basic
      description = "SiaraMaina Clan Informatics Support";
    }

    const origin = req.headers.origin || "http://localhost:8080";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: description,
              metadata: { planType, userId, userEmail },
            },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&payment_status=success`,
      cancel_url: `${origin}/?payment_status=cancelled`,
      customer_email: userEmail || undefined,
      metadata: {
        userId: userId || "",
        userEmail: userEmail || "",
        planType,
      },
    });

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (err: any) {
    console.error("[Stripe Session] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Cryptographically Verified & Idempotent Webhook Endpoint
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] || "";
  let event: Stripe.Event;

  try {
    if (!stripe) {
      return res.status(400).send("Stripe is not initialized on the server.");
    }

    // Capture the raw body exactly for signature verification
    const rawBody = (req as any).rawBody || req.body;

    // Verify cryptographic signature strictly
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.warn(`[Stripe Webhook] Cryptographic validation failed, attempting direct verification...`);
      // Fallback verification if secret is not set or has clock issues (Option 2)
      if (req.body && req.body.id) {
        event = await stripe.events.retrieve(req.body.id);
      } else {
        throw new Error("Unable to construct or retrieve event safely.");
      }
    }

    // 1. Process checkout.session.completed idempotently
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const checkoutSessionId = session.id;

      // Idempotency: Check if this checkoutSessionId has already been recorded
      let alreadyProcessed = false;

      const localPayments = dbEngine.getCollection("payments") || [];
      alreadyProcessed = localPayments.some((p: any) => p.checkout_session_id === checkoutSessionId);

      if (alreadyProcessed) {
        console.log(`[Stripe Webhook] Duplicate event ignored for CheckoutSession: ${checkoutSessionId}`);
        return res.json({ received: true, status: "duplicate_ignored" });
      }

      // Record successful payment transaction
      const paymentData = {
        checkout_session_id: checkoutSessionId,
        user_id: session.metadata?.userId || null,
        amount: session.amount_total || 0,
        currency: session.currency || "usd",
        status: "succeeded",
        idempotency_key: event.request?.idempotency_key || `stripe-evt-${event.id}`,
        metadata: {
          userEmail: session.metadata?.userEmail || "",
          planType: session.metadata?.planType || "",
          customerId: session.customer as string || "",
        },
        created_at: new Date().toISOString(),
      };

      await dbEngine.setDocument("payments", checkoutSessionId, paymentData);
      console.log(`[Database Engine] Stripe payment saved successfully for ${checkoutSessionId}`);

      // Log Security & Audit Trail
      dbEngine.logSecurityEvent({
        eventType: "PAYMENT_PROCESSED",
        email: session.metadata?.userEmail || "anonymous",
        status: "SUCCESS",
        reason: `Stripe checkout completed for amount: ${paymentData.amount}`,
      });
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error(`[Stripe Webhook Error] ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}
