import type { PricedCart } from "@conduit/domain";
import { z } from "zod";

import { UCP_CART, UCP_CHECKOUT, UCP_VERSION } from "./ucp-profile.js";

const lineItemSchema = z
  .object({
    item: z.object({ id: z.uuid() }).strict(),
    quantity: z.int().min(1).max(999),
  })
  .strict();

export const ucpCartRequestSchema = z
  .object({ line_items: z.array(lineItemSchema).max(100) })
  .strict();

export const ucpCheckoutRequestSchema = z
  .object({
    cart_id: z.uuid(),
    line_items: z.array(lineItemSchema).max(100).optional().default([]),
  })
  .strict();

export type UcpCartRequest = z.infer<typeof ucpCartRequestSchema>;
export type UcpCheckoutRequest = z.infer<typeof ucpCheckoutRequestSchema>;

export type UcpCheckoutStatus = "requires_escalation" | "completed" | "canceled";

export interface UcpCheckoutState {
  readonly id: string;
  readonly cart: PricedCart;
  readonly status: UcpCheckoutStatus;
  readonly continueUrl?: string;
  readonly expiresAt: Date;
  readonly order?: { readonly id: string };
}

export function projectUcpCart(cart: PricedCart) {
  return {
    ucp: envelope(UCP_CART),
    id: cart.id,
    line_items: cart.lines.map((line) => ({
      id: `${cart.id}:${line.productId}`,
      item: {
        id: line.productId,
        title: line.displayName,
        price: minorUnits(line.unitPrice.minorUnits),
      },
      quantity: line.quantity,
      totals: [
        {
          type: "subtotal",
          amount: minorUnits(line.lineTotal.minorUnits),
        },
      ],
    })),
    currency: cart.total.currency,
    totals: [
      { type: "subtotal", amount: minorUnits(cart.total.minorUnits) },
      { type: "total", amount: minorUnits(cart.total.minorUnits) },
    ],
  };
}

export function projectUcpCheckout(state: UcpCheckoutState) {
  const cart = projectUcpCart(state.cart);
  return {
    ...cart,
    ucp: envelope(UCP_CHECKOUT),
    id: state.id,
    status: state.status,
    links: [
      { type: "privacy_policy", url: "https://example.invalid/privacy" },
      { type: "terms_of_service", url: "https://example.invalid/terms" },
    ],
    expires_at: state.expiresAt.toISOString(),
    ...(state.status === "requires_escalation"
      ? {
          continue_url: state.continueUrl,
          messages: [
            {
              type: "info",
              code: "buyer_review_required",
              content:
                "The buyer must review and authorize this checkout in the trusted CONDUIT UI.",
              severity: "requires_buyer_review",
            },
          ],
        }
      : {}),
    ...(state.order
      ? {
          order: {
            id: state.order.id,
            permalink_url: `https://example.invalid/orders/${state.order.id}`,
          },
        }
      : {}),
  };
}

export function ucpError(code: string, content: string) {
  return {
    ucp: { version: UCP_VERSION, status: "error" as const },
    messages: [{ type: "error", code, content, severity: "unrecoverable" as const }],
  };
}

function envelope(capability: string) {
  return {
    version: UCP_VERSION,
    status: "success" as const,
    capabilities: { [capability]: [{ version: UCP_VERSION }] },
    payment_handlers: {},
  };
}

function minorUnits(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("UCP amount exceeds JavaScript's safe integer range");
  }
  return amount;
}
