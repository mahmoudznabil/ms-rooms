import { describe, expect, it } from "vitest";
import {
  RECHARGE_GRACE_RECHARGES,
  RECHARGE_OUTSTANDING_CAP_USD,
  checkAllowance,
  outstandingCents,
  pickAdminForAssignment,
  successfulRecharges,
  type CreditRecord,
} from "@/workers/recharge-policy";

/**
 * The recharge allowance is the one place a bug silently creates money, so the
 * rule is pinned here rather than left to the handler: admins credit users
 * offline, and after the grace period a user may carry at most $100 of UNPAID
 * credit. Marking a recharge paid frees the allowance again.
 */

let seq = 0;
function credit(usd: number, status: CreditRecord["status"] = "unpaid"): CreditRecord {
  seq += 1;
  return { id: `c${seq}`, usdCents: Math.round(usd * 100), status };
}

/** N settled recharges, so a user is past the grace period. */
function pastGrace(n = RECHARGE_GRACE_RECHARGES): CreditRecord[] {
  return Array.from({ length: n }, () => credit(1, "paid"));
}

describe("outstandingCents / successfulRecharges", () => {
  it("counts only unpaid credit as outstanding", () => {
    const list = [credit(40), credit(30), credit(10, "paid"), credit(5, "void")];
    expect(outstandingCents(list)).toBe(7000);
  });

  it("counts paid and unpaid as successful, void as not", () => {
    const list = [credit(1, "paid"), credit(2), credit(3, "void")];
    expect(successfulRecharges(list)).toBe(2);
  });
});

describe("checkAllowance — grace period", () => {
  it("allows anything below the grace threshold", () => {
    const list = pastGrace(RECHARGE_GRACE_RECHARGES - 1);
    const d = checkAllowance(list, 500_00);
    expect(d.allowed).toBe(true);
    expect(d.inGrace).toBe(true);
  });

  it("allows a first-time user a $500 package", () => {
    const d = checkAllowance([], 500_00);
    expect(d.allowed).toBe(true);
    expect(d.inGrace).toBe(true);
  });

  it("still allows above the cap while in grace", () => {
    // One credit short of the threshold AND already carrying $500 unpaid:
    // the cap must not bite until the user actually reaches the threshold.
    const list = pastGrace(RECHARGE_GRACE_RECHARGES - 2);
    list.push(credit(500));
    expect(successfulRecharges(list)).toBe(RECHARGE_GRACE_RECHARGES - 1);
    expect(checkAllowance(list, 100_00).allowed).toBe(true);
  });

  it("the credit that reaches the threshold is itself still in grace", () => {
    // 28 paid + 1 unpaid($500) = 29 recharges, in grace.
    // The 30th lands exactly on the threshold and is granted; the 31st is capped.
    const list = pastGrace(RECHARGE_GRACE_RECHARGES - 2);
    list.push(credit(500));
    expect(checkAllowance(list, 10_00).allowed).toBe(true);
    expect(successfulRecharges(list)).toBe(RECHARGE_GRACE_RECHARGES - 1);
  });
});

describe("checkAllowance — the $100 cap past grace", () => {
  it("allows a credit that fits under the cap", () => {
    const d = checkAllowance(pastGrace(), 99_99);
    expect(d.allowed).toBe(true);
    expect(d.inGrace).toBe(false);
  });

  it("allows a credit that lands exactly on the cap", () => {
    const list = pastGrace();
    list.push(credit(99));
    const d = checkAllowance(list, 1_00);
    expect(d.allowed).toBe(true);
  });

  it("refuses when the request would overshoot the cap", () => {
    const list = pastGrace();
    list.push(credit(99));
    const d = checkAllowance(list, 5_00);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/only \$1\.00/i);
    expect(d.reason).toMatch(/mark an earlier recharge as paid/i);
  });

  it("refuses everything once the cap is fully consumed", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD));
    const d = checkAllowance(list, 1_00);
    expect(d.allowed).toBe(false);
    expect(d.remainingUsd).toBe(0);
    expect(d.reason).toMatch(/reached the \$100 unpaid allowance cap/i);
  });

  it("frees the allowance again when credit is marked paid", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD));
    expect(checkAllowance(list, 1_00).allowed).toBe(false);

    // Marking the big credit paid drops outstanding to 0 → creditable again.
    list[list.length - 1].status = "paid";
    const after = checkAllowance(list, 99_99);
    expect(after.allowed).toBe(true);
    expect(after.remainingUsd).toBeCloseTo(RECHARGE_OUTSTANDING_CAP_USD, 5);
  });

  it("voided credit frees the allowance without counting as a recharge", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD, "void"));
    const d = checkAllowance(list, 99_99);
    expect(d.allowed).toBe(true);
  });
});

describe("pickAdminForAssignment", () => {
  const admins = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns null with no admins and no fallback", () => {
    expect(pickAdminForAssignment([], new Map(), null)).toBe(null);
  });

  it("uses the fallback when there are no admins", () => {
    expect(pickAdminForAssignment([], new Map(), "f")).toBe("f");
  });

  it("picks the admin with the fewest customers", () => {
    const load = new Map([
      ["a", { customers: 5, openRequests: 0 }],
      ["b", { customers: 2, openRequests: 9 }],
      ["c", { customers: 7, openRequests: 0 }],
    ]);
    expect(pickAdminForAssignment(admins, load, null)).toBe("b");
  });

  it("breaks a customer tie on open requests", () => {
    const load = new Map([
      ["a", { customers: 3, openRequests: 4 }],
      ["b", { customers: 3, openRequests: 1 }],
      ["c", { customers: 3, openRequests: 8 }],
    ]);
    expect(pickAdminForAssignment(admins, load, null)).toBe("b");
  });

  it("is deterministic on a full tie (lowest id)", () => {
    const load = new Map([
      ["a", { customers: 1, openRequests: 1 }],
      ["b", { customers: 1, openRequests: 1 }],
      ["c", { customers: 1, openRequests: 1 }],
    ]);
    expect(pickAdminForAssignment(admins, load, null)).toBe("a");
  });

  it("treats an admin missing from the load map as empty", () => {
    const load = new Map([["a", { customers: 4, openRequests: 0 }]]);
    // b and c have no entry → 0 customers → they win the tie by id.
    expect(pickAdminForAssignment(admins, load, null)).toBe("b");
  });
});