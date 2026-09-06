import { isIP } from "node:net";

const TRACKING = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"]);
const BLOCKED_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com"];

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    let url = new URL(raw, base);
    const redirect = url.hostname.endsWith("duckduckgo.com") ? url.searchParams.get("uddg") : null;
    if (redirect) url = new URL(redirect);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isPrivateAddress(address: string): boolean {
  if (!isIP(address)) return true;
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
