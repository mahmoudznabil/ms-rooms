/**
 * Recharge allowance policy — pure functions, no DB, no I/O.
 *
 * Recharges are admin-managed (no card processor). An admin credits a user
 * coins; the user is expected to pay the admin offline. That makes this a
 * credit-exposure ledger, so the rule that matters is: how much unpaid
 * credit may a single user carry?
 *
 * THE RULE (see RECHARGE_GRACE_RECHARGES / RECHARGE_OUTSTANDING_CAP_USD):
 *   - Below `RECHARGE_GRACE_RECHARGES` successful recharges a user has
 *     received, the admin is credited freely (grace period for new users).
 *   - At or above it, a user's total UNPAID credit may not exceed
 *     `RECHARGE_OUTSTANDING_CAP_USD` (default $100). Further credit is
 *     refused until the admin marks earlier credit as paid — which is what
 *     frees the allowance again.
 *
 * Both numbers live here and nowhere else, so changing the policy is a
 * one-line edit.
 */

/** Recharges received before the allowance cap starts applying. */
export const RECHARGE_GRACE_RECHARGES = 30;

/** Maximum unpaid credit a user may carry once past the grace period. */
export const RECHARGE_OUTSTANDING_CAP_USD = 100;

export type RechargeCreditStatus = "unpaid" | "paid" | "void";

export interface CreditRecord {
  id: string;
  usdCents: number;
  status: RechargeCreditStatus;
}

export interface AllowanceDecision {
  allowed: boolean;
  /** USD (not cents) the user may still be credited, ignoring this request. */
  remainingUsd: number;
  /** True when the cap is not in force (still inside the grace period). */
  inGrace: boolean;
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
 * May an admin credit this user another `usdCents`?
 *
 * `usdCents` must already be validated as a positive integer; callers reject
 * bad input before reaching here.
 */
export function checkAllowance(
  credits: CreditRecord[],
  usdCents: number
): AllowanceDecision {
  const granted = successfulRecharges(credits);
  const outstanding = outstandingCents(credits);
  const capCents = RECHARGE_OUTSTANDING_CAP_USD * 100;

  if (granted < RECHARGE_GRACE_RECHARGES) {
    // Grace period: no cap. Report the headroom as if the cap were the only
    // limit, so the UI can still show a number that means something.
    return {
      allowed: true,
      remainingUsd: Math.max(0, (capCents - outstanding) / 100),
      inGrace: true,
    };
  }

  const remaining = capCents - outstanding;
  if (remaining <= 0) {
    return {
      allowed: false,
      remainingUsd: 0,
      inGrace: false,
      reason: `This user has reached the $${RECHARGE_OUTSTANDING_CAP_USD} unpaid allowance cap. Mark an earlier recharge as paid before crediting more.`,
    };
  }
  if (usdCents > remaining) {
    return {
      allowed: false,
      remainingUsd: remaining / 100,
      inGrace: false,
      reason: `Only $${(remaining / 100).toFixed(2)} of unpaid allowance left — this request is $${(usdCents / 100).toFixed(2)}. Mark an earlier recharge as paid, or credit a smaller package.`,
    };
  }
  return { allowed: true, remainingUsd: remaining / 100, inGrace: false };
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