import { writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";

/**
 * Write android/local.properties with a path AGP will actually accept.
 *
 * Two Windows-specific traps, both of which produce the same unhelpful error:
 *
 *   "java.io.IOException: The filename, directory name, or volume label syntax
 *    is incorrect" thrown from SdkLocator$SdkLocationSource.validateSdkPath
 *
 * 1. CRLF. PowerShell's Out-File writes \r\n, and java.util.Properties keeps the
 *    trailing \r as part of the value, so the path ends in a stray carriage
 *    return and fails validation. Hence the explicit \n and no PowerShell here.
 * 2. Mixed separators. Android Studio writes sdk.dir with FORWARD slashes even
 *    on Windows. A value like C:\Users\x\AppData\Local/Android/Sdk is a legal
 *    Windows path but is not the form AGP is happy with.
 *
 * Written as forward slashes throughout with an LF-terminated single line.
 * The file is gitignored -- it is machine-specific by definition.
 */

const sdk = process.env.ANDROID_HOME ?? process.env.LOCALAPPDATA + "\\Android\\Sdk";
if (!sdk) {
  console.error("set ANDROID_HOME, or LOCALAPPDATA so the default SDK path can be derived");
  process.exit(1);
}

const dir = sdk.replace(/\\/g, "/").replace(/\/+$/, "");
if (!existsSync(dir)) {
  console.error(`SDK directory does not exist: ${dir}`);
  console.error("install the Android SDK command-line tools, or point ANDROID_HOME at it");
  process.exit(1);
}

const file = "android/local.properties";
writeFileSync(file, `sdk.dir=${dir}\n`, "utf8");

const raw = readFileSync(file);
const bytes = [...raw];
const hasCr = bytes.includes(0x0d);
console.log(`wrote ${file}`);
console.log(`  content : ${JSON.stringify(raw.toString("utf8"))}`);
console.log(`  bytes   : ${bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`  has CR  : ${hasCr}  ${hasCr ? "<-- would fail AGP validation" : "(ok)"}`);
console.log(`  all fwd : ${!dir.includes("\\")}`);

void unlinkSync;
void rmSync;
