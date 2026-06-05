import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await Promise.all([
  copyFile(join(root, "app", "index.html"), join(dist, "index.html")),
  copyFile(join(root, "app", "styles.css"), join(dist, "styles.css")),
  copyFile(join(root, "app", "app.js"), join(dist, "app.js")),
  copyFile(join(root, "app", "cloud.js"), join(dist, "cloud.js")),
  copyFile(join(root, "app", "monthly-bonus.js"), join(dist, "monthly-bonus.js")),
  copyFile(join(root, "app", "lucide-icons.js"), join(dist, "lucide-icons.js")),
  copyFile(join(root, "app", "child-design.js"), join(dist, "child-design.js")),
  copyFile(join(root, "app", "child-design-fix.js"), join(dist, "child-design-fix.js")),
  copyFile(join(root, "app", "child-plus-fix.js"), join(dist, "child-plus-fix.js")),
  copyFile(join(root, "app", "manifest.webmanifest"), join(dist, "manifest.webmanifest")),
  copyFile(join(root, "app", "icon.svg"), join(dist, "icon.svg")),
  copyFile(join(root, "app", "logo.svg"), join(dist, "logo.svg")),
  copyFile(join(root, "app", "image.jpg"), join(dist, "image.jpg")),
]);

async function loadLocalEnv() {
  try {
    const text = await readFile(join(root, ".env.local"), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

const localEnv = await loadLocalEnv();
const config = {
  url: process.env.INCE_SUPABASE_URL || localEnv.INCE_SUPABASE_URL || "",
  anonKey: process.env.INCE_SUPABASE_ANON_KEY || localEnv.INCE_SUPABASE_ANON_KEY || "",
};

await writeFile(
  join(dist, "config.js"),
  `window.INCE_SUPABASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
