// Shared static-site build for the Skelsol web apps, step 2 of
// `npm run build` (step 1 is `tsc --build`, which compiles src/ into
// dist/). Each app keeps a thin `build.mjs` wrapper that calls
// `buildApp` with its own directory and display name. Assembles dist/
// into a complete static site servable from any static host:
//   - public/ (index.html, import map, assets/) copied into dist/
//   - the spooky UI kit CSS copied into dist/spooky.css
//   - the compiled template copied into dist/template/, so the import
//     map's "@skelsol/template" entry resolves relatively.
// Test files are not part of the site and are left out.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const isSiteFile = (src) => !/\.test\./.test(src);

/**
 * Build one app's static site.
 *
 * @param {{ appDir: string, appName: string }} app
 *   `appDir` is the app's directory (it holds public/ and dist/);
 *   `appName` is the display name used in log and error messages.
 */
export function buildApp({ appDir, appName }) {
  const repoRoot = join(appDir, "..", "..");
  const distDir = join(appDir, "dist");

  mkdirSync(distDir, { recursive: true });

  // 0. tsc compiles the app's tests into dist/ too (the tsconfig includes
  // src/); the page never loads them, so drop them from the site.
  for (const file of readdirSync(distDir)) {
    if (/\.test\./.test(file)) {
      rmSync(join(distDir, file), { force: true });
    }
  }

  // 1. The page (index.html + import map) and its assets.
  cpSync(join(appDir, "public"), distDir, { recursive: true });

  // 2. The spooky UI kit theme.
  cpSync(
    join(repoRoot, "packages", "template", "ui", "spooky.css"),
    join(distDir, "spooky.css"),
  );

  // 3. The compiled template, minus its test files.
  const templateDist = join(distDir, "template");
  rmSync(templateDist, { recursive: true, force: true });
  cpSync(join(repoRoot, "packages", "template", "dist"), templateDist, {
    recursive: true,
    filter: isSiteFile,
  });

  // Sanity: every file the page and import map need must exist. The
  // whole template is copied, so market.js is required for both apps
  // even though only the market page uses it directly.
  const required = [
    join(distDir, "index.html"),
    join(distDir, "main.js"),
    join(distDir, "spooky.css"),
    join(distDir, "template", "index.js"),
    join(distDir, "template", "market.js"),
    join(distDir, "template", "ui.js"),
  ];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(
      `${appName} build failed: missing ${missing.join(", ")}.\n` +
        "Run the tsc step first (npm run build does both).",
    );
    process.exit(1);
  }
  console.log(`${appName} build complete: dist/ is a complete static site.`);
}
