import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
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
