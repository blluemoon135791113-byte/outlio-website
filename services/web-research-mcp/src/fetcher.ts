import { lookup } from "node:dns/promises";
import type { Config } from "./config.js";
import { isBlockedHost, isPrivateAddress, normalizeUrl } from "./url.js";
import { ResearchError } from "./types.js";

export type FetchedPage = { url: string; html: string; contentType: string };

export class PageFetcher {
  constructor(private readonly config: Config, private readonly fetchImpl: typeof fetch = fetch) {}

  async fetch(rawUrl: string): Promise<FetchedPage> {
    let current = normalizeUrl(rawUrl);
    if (!current) throw new ResearchError("INVALID_URL", "URL is not a public HTTP(S) URL");
    for (let redirect = 0; redirect <= 4; redirect++) {
      const url = new URL(current); await this.assertPublic(url);
      const response = await this.withRetry(url);
      if (response.status >= 300 && response.status < 400) {
        const next = normalizeUrl(response.headers.get("location") ?? "", current);
        if (!next) throw new ResearchError("INVALID_REDIRECT", "Page returned an invalid redirect");
        current = next; continue;
      }
      if (!response.ok) throw new ResearchError("FETCH_HTTP_ERROR", `Page returned HTTP ${response.status}`, response.status === 429 || response.status >= 500);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new ResearchError("UNSUPPORTED_CONTENT", `Unsupported content type: ${contentType || "unknown"}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > this.config.MAX_PAGE_BYTES) throw new ResearchError("PAGE_TOO_LARGE", "Page exceeds configured size limit");
      const reader = response.body?.getReader(); if (!reader) throw new ResearchError("EMPTY_RESPONSE", "Page returned no body");
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > this.config.MAX_PAGE_BYTES) { await reader.cancel(); throw new ResearchError("PAGE_TOO_LARGE", "Page exceeds configured size limit"); } chunks.push(value); }
      const html = new TextDecoder().decode(Buffer.concat(chunks));
      if (/(?:class|id)=["'][^"']*captcha|<title>[^<]*(?:captcha|verify)|verify you are human|enable javascript.{0,160}continue/i.test(html.slice(0, 80_000))) throw new ResearchError("RESTRICTED_PAGE", "Page requires a challenge or login; it was not bypassed");
      return { url: current, html, contentType };
    }
    throw new ResearchError("TOO_MANY_REDIRECTS", "Page exceeded redirect limit");
  }

  private async assertPublic(url: URL) {
    if (isBlockedHost(url.hostname)) throw new ResearchError("RESTRICTED_HOST", `Fetching ${url.hostname} is disabled`);
    let addresses;
    try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); }
    catch { throw new ResearchError("DNS_ERROR", `Could not resolve ${url.hostname}`, true); }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new ResearchError("SSRF_BLOCKED", "Destination resolves to a private or reserved address");
  }

  private async withRetry(url: URL): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; OutlioResearch/1.0; +https://outlio.io)" } });
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) { await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt)); continue; }
        return response;
      } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt)); }
      finally { clearTimeout(timer); }
    }
    throw new ResearchError("FETCH_FAILED", last instanceof Error ? last.message : "Page fetch failed", true);
  }
}
