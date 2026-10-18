import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native app configuration (Capacitor).
 *
 * WHY A WRAPPER AND NOT A REWRITE
 *
 * The app already ships a working web frontend: Firebase Auth in JS, WebRTC
 * calls, rooms, chat, games, wallet. Wrapping that same build means the native
 * app inherits all of it and needs no parallel implementation -- which is the
 * whole point, because the media stack is the part you asked to be preserved.
 *
 * The practical consequence is that there is NO google-services.json and NO
 * native Firebase SDK in this project. Firebase Auth runs entirely in the
 * webview against the same project the web app uses. Do not add the Android
 * Firebase SDK "to be safe": it would be a second, divergent identity path.
 *
 * WHY androidScheme IS "https"
 *
 * getUserMedia only works in a secure context. Capacitor's default Android
 * scheme is http://localhost, which is treated as insecure, so the microphone
 * and camera would fail with NotAllowedError and every call would be dead on
 * arrival. This one line is what makes voice work on Android at all.
 *
 * ANDROID PERMISSIONS ARE NOT HERE
 *
 * Capacitor has no first-class permissions key in this config, so the
 * permissions are NOT applied by this file. They go into the generated
 * AndroidManifest as a separate step, documented in
 * docs/MOBILE-BUILD.md -- editing it by hand is the only supported route, and
 * forgetting it produces an app that installs and then cannot hear anything.
 */
const config: CapacitorConfig = {
  appId: "com.msrooms.app",
  appName: "MS-ROOMS",
  webDir: "out",

  server: {
    // Live site. Same-origin, so the browser path needs no CORS at all.
    url: "https://ms-rooms.pages.dev",
    androidScheme: "https",
    iosScheme: "https",
    // Production is HTTPS-only; a cleartext fallback would silently downgrade.
    cleartext: false,
  },

  android: {
    // Keep the release build reproducible rather than picking up whatever is
    // in the local SDK path.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: true,
  },

  plugins: {
    // WebRTC in a webview needs the microphone permission requested at runtime,
    // not just declared in the manifest.
    "CapacitorHttp": {
      enabled: false,
    },
  },
};

export default config;
