import { readFileSync, writeFileSync } from "node:fs";

/**
 * Add the media permissions the Capacitor-generated manifest does not include.
 *
 * `npx cap add android` generates a manifest with only INTERNET. An app
 * built from it installs and then cannot hear anything: getUserMedia fails
 * with NotAllowedError and every voice room is dead. RECORD_AUDIO is the
 * difference between a working app and a silent one, and nothing in the
 * generated project or the Capacitor config adds it.
 *
 * This is a script rather than a one-off edit because the manifest is a
 * GENERATED file: `npx cap add android` on a fresh checkout would produce the
 * bare one again, and anyone regenerating it would silently ship a silent app.
 * Run it after `cap add android`.
 *
 * Idempotent — safe to re-run; it replaces the permissions block wholesale.
 */

const MANIFEST = "android/app/src/main/AndroidManifest.xml";

const block = `  <!-- Permissions -->

  <!-- Voice rooms. Without this the app installs and cannot hear anything:
       getUserMedia fails with NotAllowedError and every call is dead. -->
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <!-- Video calls and screen sharing. -->
  <uses-permission android:name="android.permission.CAMERA" />
  <!-- Speaker / earpiece / Bluetooth headset routing during a call. -->
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  <uses-permission android:name="android.permission.INTERNET" />

  <!-- Stops the app being installed on a device with no mic, where it would
       fail silently at first launch. -->
  <uses-feature android:name="android.hardware.microphone" android:required="true" />
`;

let s = readFileSync(MANIFEST, "utf8");
const start = s.indexOf("  <!-- Permissions -->");
if (start === -1) {
  console.error(`could not find the Permissions block in ${MANIFEST}`);
  process.exit(1);
}
const end = s.lastIndexOf("</manifest>");
if (end === -1 || end < start) {
  console.error(`could not find </manifest> in ${MANIFEST}`);
  process.exit(1);
}

s = s.slice(0, start) + block + s.slice(end);
writeFileSync(MANIFEST, s, "utf8");

const required = [
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.INTERNET",
  'android:name="android.hardware.microphone"',
];
const missing = required.filter((r) => !s.includes(r));
if (missing.length) {
  console.error(`MISSING after write: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("manifest permissions verified: RECORD_AUDIO, CAMERA, MODIFY_AUDIO_SETTINGS, INTERNET, mic feature");
