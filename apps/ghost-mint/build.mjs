// Ghost Mint static-site build, step 2 of `npm run build` (step 1 is
// `tsc --build`, which compiles src/ into dist/). The shared logic
// lives in `apps/build-app.mjs`; this file only names the app.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../build-app.mjs";

buildApp({
  appDir: dirname(fileURLToPath(import.meta.url)),
  appName: "Ghost Mint",
});
