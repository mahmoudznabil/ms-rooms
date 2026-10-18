import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Generated output is not source.
  //
  // out/ is the static export. android/app/src/main/assets/public/ is a COPY of
  // it that `npx cap sync` writes for the native shell -- 169 files that lint
  // as application code, which produced 10 errors and ~4000 warnings that all
  // vanished once they were ignored. eslint does not read .gitignore, so every
  // generated directory has to be named here.
  //
  // This also explains a warning count that moved between 484 and 85 across
  // earlier runs with no source change: the difference was whether generated
  // output happened to be on disk, not anything about the code.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Capacitor: synced web assets and gradle output.
    "android/app/src/main/assets/public/**",
    "android/app/build/**",
    "android/build/**",
    "android/.gradle/**",
    "ios/App/build/**",
    "ios/App/App/public/**",
    "ios/Pods/**",
  ]),
  {
    rules: {
      // Data fetching in effects is the standard React pattern (see lib/useAsync).
      // The compiler flags every setState-in-effect, including intentional
      // load-on-mount flows. Keep it as a warning so real render-storm bugs
      // (unthrottled 60fps meters, effect-driven cascades) still surface in
      // review, without failing the launch gate on every page loader.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
