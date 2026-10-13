import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_GUMROAD_PRODUCT_ID = "6WZIgtSizudGA8LxaFn--g==";
const GUMROAD_PRODUCT_ID = process.env.WEBVIEW_MCP_GUMROAD_PRODUCT_ID || DEFAULT_GUMROAD_PRODUCT_ID;
const CACHE_DIR = join(homedir(), ".webview-mcp");
const CACHE_FILE = join(CACHE_DIR, "license-cache.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-verify weekly, work offline in between

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {
    // Cache is a convenience, not a requirement — ignore write failures.
  }
}

async function verifyWithGumroad(licenseKey) {
  const res = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      product_id: GUMROAD_PRODUCT_ID,
      license_key: licenseKey,
      increment_uses_count: "false",
    }),
  });
  const data = await res.json();
  return Boolean(data.success);
}

/**
 * Checks whether a Pro license is active. Verifies online, cached for
 * CACHE_TTL_MS so the server can still start without network access —
 * only re-hits Gumroad once the cache goes stale.
 */
export async function isProLicensed() {
  const licenseKey = (process.env.WEBVIEW_MCP_LICENSE_KEY || "").trim();
  if (!licenseKey) return false;

  const cache = readCache();
  if (cache && cache.licenseKey === licenseKey && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    return cache.valid;
  }

  try {
    const valid = await verifyWithGumroad(licenseKey);
    writeCache({ licenseKey, valid, checkedAt: Date.now() });
    return valid;
  } catch {
    // Network unavailable: fall back to the last known-good cached result
    // rather than locking out a paying user because they're offline.
    if (cache && cache.licenseKey === licenseKey) return cache.valid;
    return false;
  }
}

export const PURCHASE_URL = "https://9298143553819.gumroad.com/l/jxptds";
