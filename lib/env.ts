import fs from "fs";
import path from "path";

function loadEnvLocal(): Record<string, string> {
  try {
    const content = fs.readFileSync(
      path.join(process.cwd(), ".env.local"),
      "utf-8"
    );
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

const localEnv = loadEnvLocal();

export function getEnv(key: string): string | undefined {
  return process.env[key] ?? localEnv[key];
}
