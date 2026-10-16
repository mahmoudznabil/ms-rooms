import { afterEach, describe, expect, it, vi } from "vitest";
import { adminMe, ApiError, fetchRooms, type ApiUser } from "@/lib/api";
import { useSession } from "@/stores/useSession";

/**
 * Regression test for the post-login boot-out: AppShell calls /api/admin/me
 * on every page load to resolve the admin role, and that endpoint 401s for
 * every non-admin. The global 401 interceptor used to treat that as "session
 * expired" — clearing the session and bouncing to /login right after sign-in,
 * so users could never reach their profile.
 *
 * Rule: only a 401 outside the auth and admin families means "logged out".
 */

const fakeUser = {
  id: "u-test",
  username: "tester",
  display_name: "Tester",
  avatar_url: null,
  bio: null,
  coins: 0,
  gems: 0,
  xp: 0,
} as ApiUser;

function mockFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ ok: false, error: "denied" }),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSession.setState({ user: null, ready: false, authError: null });
});

describe("global 401 handling", () => {
  it("keeps the session on an admin-endpoint 401 (not an admin, still logged in)", async () => {
    useSession.setState({ user: fakeUser, ready: true });
    mockFetch(401);
    await expect(adminMe()).rejects.toBeInstanceOf(ApiError);
    // The load-bearing assertion: the user must survive the role check.
    expect(useSession.getState().user).toEqual(fakeUser);
  });

  it("still clears the session on a real expired-session 401", async () => {
    useSession.setState({ user: fakeUser, ready: true });
    mockFetch(401);
    await expect(fetchRooms()).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().user).toBeNull();
  });
});
