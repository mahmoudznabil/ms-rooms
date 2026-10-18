import { describe, it, expect } from "vitest";
import {
  canReleaseCustomer,
  canReadCreditLedger,
  canSeeUserPii,
  USER_LIST_COLUMNS_SAFE,
  USER_LIST_COLUMNS_PII,
} from "../../workers/admin-policy";

/**
 * These tests exist because every rule below was found by a manual route audit
 * of backend.ts, not by a failing test. `POST /api/admin/customers/release` had
 * no ownership check and shipped; nothing in the suite could see that. The
 * handler still exists and can still be edited — this module only makes the
 * rule itself regression-proof.
 */

describe("canReleaseCustomer", () => {
  it("lets an admin release their own customer", () => {
    expect(canReleaseCustomer("support", "adm_1", "adm_1").ok).toBe(true);
  });

  it("refuses a non-master admin releasing another admin's customer", () => {
    // The actual bug: /claim refused this, /release did not.
    const d = canReleaseCustomer("support", "adm_2", "adm_1");
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it("refuses finance releasing another admin's customer", () => {
    expect(canReleaseCustomer("finance", "adm_2", "adm_1").status).toBe(403);
  });

  it("lets master_admin release any customer as an escape hatch", () => {
    expect(canReleaseCustomer("master_admin", "adm_root", "adm_1").ok).toBe(true);
  });

  it("refuses releasing an unassigned customer instead of silently succeeding", () => {
    const d = canReleaseCustomer("support", "adm_1", null);
    expect(d.ok).toBe(false);
    expect(d.status).toBe(409);
  });

  it("lets master_admin release an unassigned customer", () => {
    expect(canReleaseCustomer("master_admin", "adm_root", null).ok).toBe(true);
  });
});

describe("canReadCreditLedger", () => {
  it("lets finance read any ledger", () => {
    expect(canReadCreditLedger("finance", "adm_1", "adm_9").ok).toBe(true);
  });

  it("lets master_admin read any ledger", () => {
    expect(canReadCreditLedger("master_admin", "adm_root", "adm_9").ok).toBe(true);
  });

  it("refuses support reading a ledger they do not own", () => {
    const d = canReadCreditLedger("support", "adm_2", "adm_1");
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it("lets support read the ledger of a customer they own", () => {
    expect(canReadCreditLedger("support", "adm_1", "adm_1").ok).toBe(true);
  });

  it("refuses support reading an unassigned customer's ledger", () => {
    // ownerId null must not read as a match.
    expect(canReadCreditLedger("support", "adm_1", null).ok).toBe(false);
  });
});

describe("canSeeUserPii", () => {
  it("allows master_admin", () => {
    expect(canSeeUserPii("master_admin").ok).toBe(true);
  });

  it("refuses support", () => {
    expect(canSeeUserPii("support").status).toBe(403);
  });

  it("refuses finance", () => {
    expect(canSeeUserPii("finance").status).toBe(403);
  });
});

describe("user list projection", () => {
  it("keeps contact details and identity ids out of the safe column set", () => {
    // This is the assertion that matters for /api/admin/users: email, phone and
    // firebase_uid were being returned to every admin role.
    for (const col of ["email", "phone", "firebase_uid", "provider"]) {
      expect(USER_LIST_COLUMNS_SAFE).not.toContain(col);
      expect(USER_LIST_COLUMNS_PII).toContain(col);
    }
  });

  it("does not duplicate a column across the two sets", () => {
    const overlap = USER_LIST_COLUMNS_SAFE.filter((c) =>
      USER_LIST_COLUMNS_PII.includes(c),
    );
    expect(overlap).toEqual([]);
  });

  it("keeps ban_reason available to every admin so support can act on a ban", () => {
    expect(USER_LIST_COLUMNS_SAFE).toContain("ban_reason");
  });
});
