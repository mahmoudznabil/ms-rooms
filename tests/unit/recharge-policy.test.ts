import { describe, expect, it } from "vitest";
import {
  RECHARGE_GRACE_RECHARGES,
  RECHARGE_OUTSTANDING_CAP_USD,
  RECHARGE_SETTLEMENT_DAYS,
  checkAllowance,
  hasOverdueCredit,
  outstandingCents,
  pickAdminForAssignment,
  successfulRecharges,
  type CreditRecord,
} from "@/workers/recharge-policy";

/**
 * The recharge allowance is the one place a bug silently creates money, so the
 * rule is pinned here rather than left to the handler.
 *
 * Two phases:
 *   - First 30 recharges: PREPAID — the user pays before receiving credit, so
 *     an admin may credit freely.
 *   - From the 31st: POSTPAID — the user has a card on file and may carry up to
 *     $100 unpaid, which is charged once reached. Anything unpaid past 7 days is
 *     overdue and stops the allowance extending.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-17T12:00:00Z");

let seq = 0;
function credit(
  usd: number,
  status: CreditRecord["status"] = "unpaid",
  daysAgo = 0
): CreditRecord {
  seq += 1;
  return {
    id: `c${seq}`,
    usdCents: Math.round(usd * 100),
    status,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

/** N settled recharges, so a user is past the grace period. */
function pastGrace(n = RECHARGE_GRACE_RECHARGES): CreditRecord[] {
  return Array.from({ length: n }, (_, i) => credit(1, "paid", n - i));
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
    const d = checkAllowance(pastGrace(), 99_99, NOW);
    expect(d.allowed).toBe(true);
    expect(d.inGrace).toBe(false);
  });

  it("allows a credit that lands exactly on the cap", () => {
    const list = pastGrace();
    list.push(credit(99));
    const d = checkAllowance(list, 1_00, NOW);
    expect(d.allowed).toBe(true);
  });

  it("refuses when the request would overshoot the cap", () => {
    const list = pastGrace();
    list.push(credit(99));
    const d = checkAllowance(list, 5_00, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/only \$1\.00 of unpaid allowance left/i);
    expect(d.reason).toMatch(/settle an earlier recharge/i);
  });

  it("refuses everything once the cap is fully consumed", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD));
    const d = checkAllowance(list, 1_00, NOW);
    expect(d.allowed).toBe(false);
    expect(d.remainingUsd).toBe(0);
    expect(d.reason).toMatch(/reached the \$100 unpaid allowance cap/i);
  });

  it("frees the allowance again when credit is settled", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD));
    expect(checkAllowance(list, 1_00, NOW).allowed).toBe(false);

    // Marking the big credit paid drops outstanding to 0 → creditable again.
    list[list.length - 1].status = "paid";
    const after = checkAllowance(list, 99_99, NOW);
    expect(after.allowed).toBe(true);
    expect(after.remainingUsd).toBeCloseTo(RECHARGE_OUTSTANDING_CAP_USD, 5);
  });

  it("voided credit frees the allowance without counting as a recharge", () => {
    const list = pastGrace();
    list.push(credit(RECHARGE_OUTSTANDING_CAP_USD, "void"));
    const d = checkAllowance(list, 99_99, NOW);
    expect(d.allowed).toBe(true);
  });
});

describe("hasOverdueCredit — the 7-day settlement window", () => {
  it("is false when nothing is unpaid", () => {
    expect(hasOverdueCredit(pastGrace(), NOW)).toBe(false);
  });

  it("is false while unpaid credit is inside the window", () => {
    const list = pastGrace();
    list.push(credit(50, "unpaid", RECHARGE_SETTLEMENT_DAYS - 1));
    expect(hasOverdueCredit(list, NOW)).toBe(false);
  });

  it("is true once unpaid credit ages past the window", () => {
    const list = pastGrace();
    list.push(credit(50, "unpaid", RECHARGE_SETTLEMENT_DAYS + 1));
    expect(hasOverdueCredit(list, NOW)).toBe(true);
  });

  it("ignores a settled credit that is old", () => {
    const list = pastGrace();
    list.push(credit(50, "paid", 90));
    expect(hasOverdueCredit(list, NOW)).toBe(false);
  });

  it("treats an undated unpaid credit as not overdue (admin can still see it)", () => {
    expect(hasOverdueCredit([{ id: "x", usdCents: 100, status: "unpaid" }], NOW)).toBe(false);
  });
});

describe("checkAllowance — overdue blocks before the cap", () => {
  it("refuses a credit when an earlier one is overdue, even under the cap", () => {
    const list = pastGrace();
    list.push(credit(10, "unpaid", RECHARGE_SETTLEMENT_DAYS + 2));
    const d = checkAllowance(list, 5_00, NOW);
    expect(d.allowed).toBe(false);
    expect(d.overdue).toBe(true);
    expect(d.reason).toMatch(/past its 7-day settlement window/i);
  });

  it("a stale unpaid balance is caught before bad debt can reach the cap", () => {
    // Outstanding is still tiny; the window, not the cap, is what stops it.
    const list = pastGrace();
    list.push(credit(1, "unpaid", 30));
    expect(outstandingCents(list)).toBeLessThan(RECHARGE_OUTSTANDING_CAP_USD * 100);
    expect(checkAllowance(list, 1_00, NOW).allowed).toBe(false);
  });

  it("reports overdue without blocking while still prepaid", () => {
    const list = [credit(5, "unpaid", 30)];
    const d = checkAllowance(list, 5_00, NOW);
    expect(d.inGrace).toBe(true);
    expect(d.overdue).toBe(true);
    expect(d.allowed).toBe(true); // prepaid: admin may still credit
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