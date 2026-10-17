/**
 * Recharge allowance policy — pure functions, no DB, no I/O.
 *
 * Recharges are admin-managed (no card processor). An admin credits a user
 * coins; the user is expected to pay the admin offline. That makes this a
 * credit-exposure ledger, so the rule that matters is: how much unpaid
 * credit may a single user carry, and for how long?
 *
 * THE RULE, in two phases:
 *
 *   Phase 1 — first `RECHARGE_GRACE_RECHARGES` (30) successful recharges:
 *     PREPAID. The user pays first, then receives the credit. An admin may
 *     credit freely, but the working assumption is there is nothing owed.
 *
 *   Phase 2 — from the 31st recharge on:
 *     POSTPAID. The user has a card on file and billing is active, so they may
 *     carry up to `RECHARGE_OUTSTANDING_CAP_USD` ($100) of unpaid credit —
 *     which the system withdraws (charges the saved card) once reached.
 *     Every unpaid credit is due within `RECHARGE_SETTLEMENT_DAYS` (7 days);
 *     past that the allowance stops extending and the account is flagged.
 *
 * The 30-recharge threshold is not arbitrary: it is the point at which card
 * networks and PSPs start treating an account as established. Crossing it on
 * convenience, and letting a user carry a balance indefinitely, is the exact
 * shape of "friendly fraud" (stolen card used to build history, then maxed out
 * and charged back), so phase 2 exists to bound that exposure.
 *
 * Every number lives here and nowhere else, so changing the policy is a
 * one-line edit.
 */

/** Recharges received before the account moves to postpaid billing. */
export const RECHARGE_GRACE_RECHARGES = 30;

/** Maximum unpaid credit a user may carry once past the grace period. */
export const RECHARGE_OUTSTANDING_CAP_USD = 100;

/** Days an unpaid credit may age before it is overdue. */
export const RECHARGE_SETTLEMENT_DAYS = 7;

export type RechargeCreditStatus = "unpaid" | "paid" | "void";

export interface CreditRecord {
  id: string;
  usdCents: number;
  status: RechargeCreditStatus;
  /** ISO timestamp the credit was issued; drives the settlement window. */
  createdAt?: string;
}

export interface AllowanceDecision {
  allowed: boolean;
  /** USD (not cents) the user may still be credited, ignoring this request. */
  remainingUsd: number;
  /** True while the account is still prepaid (inside the first 30 recharges). */
  inGrace: boolean;
  /** True when any unpaid credit is past its settlement window. */
  overdue: boolean;
  /** Operator-facing reason, present only when `allowed` is false. */
  reason?: string;
}

/** Unpaid credit currently carried by the user, in cents. */
export function outstandingCents(credits: CreditRecord[]): number {
  return credits
    .filter((c) => c.status === "unpaid")
    .reduce((sum, c) => sum + c.usdCents, 0);
}

/** Successful (non-voided) recharges the user has received so far. */
export function successfulRecharges(credits: CreditRecord[]): number {
  return credits.filter((c) => c.status !== "void").length;
}

/**
 * Has any unpaid credit aged past the settlement window?
 * `nowMs` is passed in so this stays pure and testable — no clock inside.
 * A credit with no/unparseable date is treated as NOT overdue rather than
 * silently blocking the admin; the admin can still see it in the ledger.
 */
export function hasOverdueCredit(credits: CreditRecord[], nowMs: number): boolean {
  const cutoff = nowMs - RECHARGE_SETTLEMENT_DAYS * 24 * 60 * 60 * 1000;
  return credits.some((c) => {
    if (c.status !== "unpaid") return false;
    if (!c.createdAt) return false;
    const t = Date.parse(c.createdAt);
    return Number.isFinite(t) && t < cutoff;
  });
}

/**
 * May an admin credit this user another `usdCents`?
 *
 * `usdCents` must already be validated as a positive integer; callers reject
 * bad input before reaching here.
 */
export function checkAllowance(
  credits: CreditRecord[],
  usdCents: number,
  nowMs: number = 0
): AllowanceDecision {
  const granted = successfulRecharges(credits);
  const outstanding = outstandingCents(credits);
  const capCents = RECHARGE_OUTSTANDING_CAP_USD * 100;
  const overdue = nowMs > 0 && hasOverdueCredit(credits, nowMs);

  if (granted < RECHARGE_GRACE_RECHARGES) {
    // Prepaid phase: the user pays first, so there is nothing owed and no cap.
    return {
      allowed: true,
      remainingUsd: Math.max(0, (capCents - outstanding) / 100),
      inGrace: true,
      overdue,
    };
  }

  // Postpaid phase. An overdue balance stops the allowance extending before the
  // cap itself does — the cap alone would let bad debt sit at exactly $100.
  if (overdue) {
    return {
      allowed: false,
      remainingUsd: 0,
      inGrace: false,
      overdue: true,
      reason: `An earlier recharge is past its ${RECHARGE_SETTLEMENT_DAYS}-day settlement window. Collect payment before crediting more.`,
    };
  }

  const remaining = capCents - outstanding;
  if (remaining <= 0) {
    return {
      allowed: false,
      remainingUsd: 0,
      inGrace: false,
      overdue: false,
      reason: `This user has reached the $${RECHARGE_OUTSTANDING_CAP_USD} unpaid allowance cap. Their card on file is charged once it is reached; settle an earlier recharge now to free the allowance.`,
    };
  }
  if (usdCents > remaining) {
    return {
      allowed: false,
      remainingUsd: remaining / 100,
      inGrace: false,
      overdue: false,
      reason: `Only $${(remaining / 100).toFixed(2)} of unpaid allowance left — this request is $${(usdCents / 100).toFixed(2)}. Settle an earlier recharge, or credit a smaller package.`,
    };
  }
  return { allowed: true, remainingUsd: remaining / 100, inGrace: false, overdue: false };
}

/**
 * Which admin should a new customer be assigned to?
 * Pure and deterministic given the inputs so it can be tested: the admin with
 * the fewest assigned customers wins; ties break on fewest open requests, then
 * on id for stability (no random, no clock).
 */
export function pickAdminForAssignment(
  admins: Array<{ id: string }>,
  load: Map<string, { customers: number; openRequests: number }>,
  fallbackAdminId: string | null
): string | null {
  if (admins.length === 0) return fallbackAdminId;
  let best: { id: string; customers: number; openRequests: number } | null = null;
  for (const a of admins) {
    const l = load.get(a.id) ?? { customers: 0, openRequests: 0 };
    const cand = { id: a.id, customers: l.customers, openRequests: l.openRequests };
    if (
      best === null ||
      cand.customers < best.customers ||
      (cand.customers === best.customers && cand.openRequests < best.openRequests) ||
      (cand.customers === best.customers &&
        cand.openRequests === best.openRequests &&
        cand.id < best.id)
    ) {
      best = cand;
    }
  }
  return best ? best.id : fallbackAdminId;
}