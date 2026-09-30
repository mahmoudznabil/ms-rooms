/**
 * A local hint that a Firebase identity might still exist.
 *
 * `useSession.boot()` falls back to re-minting a D1 session from Firebase when
 * `apiMe()` fails. That fallback imports `@/lib/firebase`, which pulls in
 * firebase/auth and — via the App Check provider — Google's reCAPTCHA script
 * (~347 KB, ~1.5s of main-thread work).
 *
 * For a logged-out visitor `apiMe()` always fails, so that fallback always ran,
 * which meant every anonymous landing-page view paid the full Firebase +
 * reCAPTCHA cost to discover there was no session to restore. The check itself
 * is free, so this flag lets us skip the import entirely when no Firebase
 * identity could possibly be present.
 *
 * Deliberately its own module with no imports, so reading it can never drag
 * Firebase back into the boot path.
 */
const KEY = "msrooms_firebase_session_hint";

/** Record that a Firebase sign-in succeeded in this browser. */
export function markFirebaseSessionPossible(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Private mode / storage disabled: the hint is an optimisation, not a
    // correctness requirement. Worst case we re-import Firebase on boot.
  }
}

/** Clear the hint on sign-out so we stop paying for the fallback. */
export function clearFirebaseSessionHint(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** True when a Firebase identity may exist and the re-mint is worth attempting. */
export function hasFirebaseSessionHint(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}