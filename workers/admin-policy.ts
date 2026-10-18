/**
 * Admin authorization policy — pure functions, no DB, no I/O.
 *
 * Every rule here was extracted from an inline `if` in backend.ts that was
 * missing a check. The handlers stayed hard to review because the authorization
 * decision was buried in request handling, and because the endpoints that DID
 * have the check gave no signal that a sibling endpoint lacked it.
 *
 * The concrete bug this exists to prevent:
 *
 *   `POST /api/admin/customers/claim` refused to take a customer another admin
 *   already owned. `POST /api/admin/customers/release` did not — it went
 *   straight to `DELETE FROM admin_customers WHERE user_id = ?`. Two adjacent
 *   endpoints, same resource, opposite rules. Any authenticated admin could
 *   release any other admin's customer, taking their open recharge requests
 *   with it, which is the whole per-admin ownership model the recharge desk is
 *   built on.
 *
 * The reason a pure module: `recharge-policy` and `room-policy` are unit
 * tested, so their rules cannot silently regress. An inline comparison in a
 * 5000-line handler has no such protection — it was wrong in the first place
 * and nothing flagged it.
 *
 * ROLES
 *   master_admin  full access, including PII and cross-admin operations
 *   support       works its own customers; no financial ledgers it does not own
 *   finance       collects payment and settles credits; may see any ledger
 */

export type AdminRole = "master_admin" | "support" | "finance";

/** Roles permitted to see user contact details and identity-provider fields. */
const PII_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>(["master_admin"]);

/** Roles permitted to act on a customer they do not own. */
const CROSS_ADMIN_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>(["master_admin"]);

/** Roles permitted to read any user's credit ledger. */
const LEDGER_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>(["master_admin", "finance"]);

export interface Decision {
  ok: boolean;
  /** HTTP status to return when `ok` is false. */
  status: number;
  /** Operator-facing reason. Never sent to the client verbatim for 401. */
  reason?: string;
}

const ALLOW: Decision = { ok: true, status: 200 };

function deny(status: number, reason: string): Decision {
  return { ok: false, status, reason };
}

/**
 * May this admin release (unassign) a customer from the customer base?
 *
 * Ownership is the boundary: a support or finance admin may only release a
 * customer assigned to them. `master_admin` may release any, which is what
 * makes it the escape hatch when an admin goes off-board.
 *
 * `ownerId` is null when the customer is unassigned. Releasing an unassigned
 * customer is a no-op that would otherwise succeed for anyone, so it is
 * refused rather than silently accepted.
 */
export function canReleaseCustomer(
  role: AdminRole,
  callerId: string,
  ownerId: string | null,
): Decision {
  if (CROSS_ADMIN_ROLES.has(role)) return ALLOW;
  if (!ownerId) return deny(409, "That customer is not assigned to anyone.");
  if (ownerId !== callerId) return deny(403, "That customer belongs to another admin.");
  return ALLOW;
}

/**
 * May this admin read a user's credit ledger?
 *
 * The ledger is the financial record: coins credited, USD owed, settlement
 * state, and the admin's own notes. `POST /api/admin/recharge/mark-paid` was
 * already restricted to finance and master_admin — the read was not, so any
 * admin role could pull any user's financial history while being unable to
 * change it. Gating the write and not the read is not a security boundary.
 */
export function canReadCreditLedger(
  role: AdminRole,
  callerId: string,
  ownerId: string | null,
): Decision {
  if (LEDGER_ROLES.has(role)) return ALLOW;
  if (ownerId && ownerId === callerId) return ALLOW;
  return deny(403, "Not authorized to read this ledger.");
}

/**
 * May this admin see contact details (email, phone) and identity-provider ids
 * in the user list?
 *
 * Support needs the list to do support work — looking someone up, seeing their
 * balance. It does not need every user's email and phone number, and the list
 * supports a LIKE search across those very columns, which turns the endpoint
 * into an enumeration oracle for the whole user table.
 *
 * The decision is about COLUMNS, not about the endpoint: callers apply this to
 * choose the projection. Blocking support from the route entirely would break
 * the job it exists for.
 */
export function canSeeUserPii(role: AdminRole): Decision {
  if (PII_ROLES.has(role)) return ALLOW;
  return deny(403, "Not authorized to view contact details.");
}

/**
 * Columns safe to return for every admin role.
 *
 * Kept next to `canSeeUserPii` deliberately: the allowlist and the permission
 * have to be edited together, and separating them across files is how a column
 * like `firebase_uid` ends up in a public projection.
 */
export const USER_LIST_COLUMNS_SAFE: readonly string[] = [
  "id",
  "username",
  "display_name",
  "id_tag",
  "coins",
  "gems",
  "xp",
  "level",
  "banned",
  "ban_reason",
  "created_at",
];

/** Columns added only when `canSeeUserPii` allows. */
export const USER_LIST_COLUMNS_PII: readonly string[] = [
  "email",
  "phone",
  "provider",
  "firebase_uid",
];
