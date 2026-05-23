import fs from "fs";
import path from "path";

// Read .env.local fresh on every call — avoids Turbopack module-init cwd issues
export function getEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const content = fs.readFileSync(
      path.join(process.cwd(), ".env.local"),
      "utf-8"
    );
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === key) {
        return line.slice(eq + 1).trim();
      }
    }
  } catch {}
  return undefined;
}
