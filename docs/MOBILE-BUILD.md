# Mobile build (Android APK + iOS)

MS-ROOMS ships as a **wrapper app**: the native shell loads the same static
build the website serves, so there is one implementation of accounts, rooms,
WebRTC calls, chat, games and wallet. The native build carries no business
logic and no second database.

This is a deliberate trade. A rewrite (React Native, Flutter) would give better
push notifications and background audio, at the cost of reimplementing the media
stack — the part most likely to break, and the part hardest to test without
phones. The wrapper ships the product that already works.

---

## What is done, and what is not

| | Status |
|---|---|
| Landing-page download button + checksum | Done, deployed |
| iOS button → App Store search | Done, deployed |
| API accepts the native webview origins (CORS) | Done, deployed |
| `capacitor.config.ts` | Done, committed |
| `android/` native project | **Not generated** — needs a machine with the Android SDK |
| Signed release APK | **Not built** — needs the SDK + a keystore |
| iOS Xcode project | **Not generated** — needs macOS + Xcode |

The blocker is not the code, it is the toolchain. The commands below produce a
signed APK on any machine with Android Studio installed.

---

## Why no `google-services.json`

The web build authenticates with Firebase Auth in JavaScript, against the same
project the website uses. Wrapping that build means the native app inherits
authentication unchanged.

**Do not add the Android Firebase SDK.** It would create a second identity path
that can disagree with the web one — the classic source of "logged in on the
site, logged out in the app" bugs. Firebase config lives in the web bundle at
build time.

---

## One-time setup

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init                 # reads capacitor.config.ts; answer no to both prompts
npx cap add android
npx cap add ios
```

`cap init` will propose an app id; use `com.msrooms.app` to match
`capacitor.config.ts`.

---

## Required Android manifest permissions

`npx cap add android` generates the project. Then edit
`android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`, directly
above `<application>`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
```

| Permission | Needed for |
|---|---|
| `RECORD_AUDIO` | Every voice room. Without it the app installs and hears nothing. |
| `CAMERA` | Video calls and screen sharing |
| `MODIFY_AUDIO_SETTINGS` | Speaker / earpiece / Bluetooth routing |
| `INTERNET` | The API |

Then request `RECORD_AUDIO` at runtime on first launch — a declared permission
is not a granted one, and Android 6+ prompts the user. Capacitor has no config
key for this, so it goes in the app's JS on the path that enters a room.

---

## Building an APK

Toolchain this was last verified with, on Windows:

| | Version | Note |
|---|---|---|
| JDK | Temurin **21** | Android Gradle Plugin 8 needs 17+. The Java 8 on Windows is far too old. |
| Android SDK | `platforms/android-36`, `build-tools/36.0.0` | Capacitor 8 targets `compileSdk 36`. |
| Gradle | 8.14.3 | Supplied by the wrapper; it downloads itself. |

### Step 0 — point Gradle at the SDK (do this first)

```bash
npm run native:sdk      # writes android/local.properties
```

Skip this and the build fails with a misleading error:

```
Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'.
> java.io.IOException: The filename, directory name, or volume label syntax is incorrect
```

thrown from `SdkLocator$SdkLocationSource.validateSdkPath`. Two Windows traps
produce it and the stacktrace names neither:

1. **CRLF.** PowerShell's `Out-File` writes `\r\n`; `java.util.Properties` keeps
   the trailing `\r` as part of the value, so the path ends in a carriage return.
2. **Mixed separators.** Android Studio writes `sdk.dir` with forward slashes
   even on Windows. `C:\Users\x\AppData\Local/Android/Sdk` is a legal Windows
   path and still fails.

The script writes `sdk.dir=C:/Users/...` with a single LF and verifies both
properties before exiting.

### Build

```bash
export JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
export ANDROID_HOME="%LOCALAPPDATA%\Android\Sdk"

npm run build
npx cap sync android

cd android && ./gradlew assembleDebug     # debug-signed, ~9 min cold
cd android && ./gradlew assembleRelease   # needs a keystore, see below
```

### Verify before publishing

Do not trust the build output alone:

```bash
"$ANDROID_HOME/build-tools/36.0.0/aapt2" dump badging app/build/outputs/apk/debug/app-debug.apk
```

Must show `name='com.msrooms.app'`, `RECORD_AUDIO`, `CAMERA` and
`MODIFY_AUDIO_SETTINGS`. Grepping the APK's `AndroidManifest.xml` for those
strings finds nothing — it is binary XML with a UTF-16 string pool — which is
why `aapt2` is the tool for it.

**Signing.** A release APK must be signed, and the keystore is the app's
identity for its whole life — losing it means you cannot update the app
without publishing a new package id and losing every install. Generate one once
and store it somewhere durable and backed up, never in the repo:

```bash
keytool -genkey -v -keystore ms-rooms-release.keystore \
  -alias ms-rooms -keyalg RSA -keysize 2048 -validity 10000
```

Configure it in `android/app/build.gradle` under `signingConfigs.release`, and
add the keystore and its properties file to `.gitignore`.

### The build that is currently published

`ms-rooms.apk` on the landing page is **debug-signed**. It installs and runs
normally, which is enough for a team test, but it cannot be upgraded in place:
replacing it later means uninstalling first, because the signature changes.
Switch to a release keystore before giving it to anyone outside the team.

---

## Publishing

```bash
# 1. Stage the signed APK (validates it is really a ZIP/APK, writes the checksum)
npm run stage:apk -- android/app/build/outputs/apk/release/app-release.apk

# 2. Build and deploy
npm run build
npx wrangler pages deploy out --project-name ms-rooms --branch master
```

The landing-page button appears on that deploy. It discovers the file with a
HEAD request, so there is no code change per release — the same two commands
push a rebuild to everyone who already installed the app.

To take a download down without touching code:

```bash
npm run stage:apk -- --clear
```

---

## iOS

Once the App Store listing exists, replace `IOS_STORE_SEARCH_URL` in
`components/MobileDownload.tsx` with the real listing link
(`https://apps.apple.com/app/id<APP_ID>`). Until then the button opens the App
Store search for "ms-rooms", which resolves into the App Store app on an iPhone.

Building iOS requires macOS and Xcode. `npx cap add ios` then
`npx cap open ios`.

---

## The recharge model, and why the app is not on Google Play

Coins are bought on the web, credited by an admin, and paid offline. Google
Play's Payments policy §2/§4/§5 requires Play Billing for digital goods and
forbids virtual currencies being used outside the app that sold them. Egypt is
not covered by any alternative-billing programme, so there is no exemption to
claim. Shipping to Play as-is risks removal and account termination.

This is why distribution is direct. It also keeps the operator's revenue whole.

F-Droid is not an option: it requires a FLOSS licence, names Firebase as a
forbidden dependency, and does not hold third-party API keys.

---

## Testing before you trust it

The web build is covered by the automated suite. **None of that covers the
native shell**, and the failure modes are specific to it:

- Microphone permission granted, then denied, then re-prompted
- Bluetooth headset routing
- Incoming call with the screen locked
- App backgrounded mid-call
- Metered mobile data joining a room
- Low-storage handling

None of these can be verified without physical devices. Treat the first
release as a beta.
