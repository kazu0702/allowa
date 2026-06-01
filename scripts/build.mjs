import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await Promise.all([
  copyFile(join(root, "app", "index.html"), join(dist, "index.html")),
  copyFile(join(root, "app", "styles.css"), join(dist, "styles.css")),
  copyFile(join(root, "app", "app.js"), join(dist, "app.js")),
  copyFile(join(root, "app", "monthly-bonus.js"), join(dist, "monthly-bonus.js")),
  copyFile(join(root, "app", "child-design.js"), join(dist, "child-design.js")),
  copyFile(join(root, "app", "child-design-fix.js"), join(dist, "child-design-fix.js")),
  copyFile(join(root, "app", "child-plus-fix.js"), join(dist, "child-plus-fix.js")),
]);

const config = {
  url: process.env.STUDYPAY_SUPABASE_URL || "",
  anonKey: process.env.STUDYPAY_SUPABASE_ANON_KEY || "",
};

await writeFile(
  join(dist, "config.js"),
  `window.STUDYPAY_SUPABASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
