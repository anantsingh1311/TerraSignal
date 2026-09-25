import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const parseEnvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) return null;

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return key ? [key, value] : null;
};

// Tiny .env loader so the backend can read DATABASE_URL without adding another package.
export const loadEnvFiles = (rootDir) => {
  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, filename);
    if (!existsSync(filePath)) continue;

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const entry = parseEnvLine(line);
      if (!entry) continue;
      const [key, value] = entry;
      process.env[key] ??= value;
    }
  }
};
