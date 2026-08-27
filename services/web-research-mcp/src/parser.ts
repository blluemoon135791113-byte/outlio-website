import * as cheerio from "cheerio";
import type { DirectSignals, ParsedPage } from "./types.js";
import { normalizeUrl } from "./url.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const OBFUSCATED_EMAIL = /\b([A-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([A-Z0-9-]+(?:\s*(?:\[dot\]|\(dot\)|\s+dot\s+|\.)\s*[A-Z0-9-]+)+)\b/gi;
/*
 * Deliberately excludes newlines. `\s` allowed a citation list such as
 * "2022.\n1 2 3 4 5 ..." to become one enormous, high-confidence phone
 * number. The final validator rejects identifiers and bare digit runs while
 * retaining ordinary international and local business-phone formatting.
 */
const PHONE = /(?<!\d)(?:\+?\d[\d().\t -]{6,}\d)(?!\d)/g;
const DATE = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})\b/gi;
const CURRENCY = /(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|m|bn))?|\d[\d,.]*\s?(?:USD|EUR|GBP))/gi;

function unique(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()).filter(Boolean))]; }

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function obfuscatedEmails(source: string): string[] {
  const output: string[] = [];
  for (const match of source.matchAll(OBFUSCATED_EMAIL)) {
    const local = match[1]?.trim();
    const host = match[2]
      ?.replace(/\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*/gi, ".")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (local && host && host.includes(".")) output.push(`${local.toLowerCase()}@${host}`);
  }
  return output;
}

function plausiblePhone(raw: string): boolean {
  const value = raw.trim().replace(/[.\s-]+$/, "");
  const digits = value.replace(/\D/g, "");

  // E.164 permits at most 15 digits. Short local numbers are too ambiguous in
  // arbitrary web text (ISBN fragments such as "0099-9660" are common), so
  // require 10 digits unless an explicit international `+` prefix is present.
  const minimumDigits = value.startsWith("+") ? 8 : 10;
  if (digits.length < minimumDigits || digits.length > 15) return false;

  // Database ids, timestamps and citation ids are commonly emitted as one
  // uninterrupted number. A leading plus is an explicit telephone signal;
  // otherwise long candidates must contain normal phone punctuation.
  if (!value.startsWith("+") && digits.length > 10 && !/[()\s-]/.test(value)) return false;

  // Reject reference lists such as "1 2 3 4 5 6 7 8" that happen to have a
  // phone-sized digit count.
  const groups = value.split(/[\s().-]+/).filter(Boolean);
  if (groups.length >= 6 && groups.filter((group) => group.length === 1).length / groups.length > .6) return false;

  // A repeated single digit is an id/placeholder, never usable contact data.
  if (/^(\d)\1+$/.test(digits)) return false;
  return true;
}

function socialProfileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);

    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      return parts.length === 2 && ["in", "company"].includes(parts[0].toLowerCase());
    }
    if (host === "twitter.com" || host === "x.com") {
      return parts.length === 1 && !["home", "search", "explore", "intent", "share", "i"].includes(parts[0].toLowerCase());
    }
    if (host === "instagram.com") {
      return parts.length === 1 && !["p", "reel", "stories", "explore"].includes(parts[0].toLowerCase());
    }
    if (host === "facebook.com") {
      return parts.length === 1 && !["posts", "videos", "photo", "watch", "share"].includes(parts[0].toLowerCase());
    }
    if (host === "github.com") {
      return parts.length === 1 && !["features", "topics", "marketplace", "search", "login", "signup"].includes(parts[0].toLowerCase());
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract facts that do not require an LLM from either cleaned page text or a
 * search-result snippet. Keeping this pure lets the pipeline use the same
 * validation rules before and after a page fetch.
 */
export function extractDirectSignals(source: string, urls: string[] = []): DirectSignals {
  return {
    emails: unique([...(source.match(EMAIL) ?? []), ...obfuscatedEmails(source)])
      .filter((email) => !/\.(png|jpg|jpeg|gif|webp)$/i.test(email)),
    phones: unique(source.match(PHONE) ?? [])
      .map((phone) => phone.replace(/[.\s-]+$/, ""))
      .filter(plausiblePhone),
    urls: unique(urls),
    dates: unique(source.match(DATE) ?? []),
    currencies: unique(source.match(CURRENCY) ?? []),
    social_links: unique(urls.filter(socialProfileUrl)),
  };
}

export class CheerioParser {
  parse(url: string, html: string): ParsedPage {
    const $ = cheerio.load(html);
    // Contact data often lives in structured markup or href attributes rather
    // than visible prose. Capture it before boilerplate removal, then run it
    // through the same deterministic validators as ordinary text.
    const structured = $('script[type="application/ld+json"]')
      .map((_, el) => $(el).text())
      .get()
      .join("\n")
      .slice(0, 50_000);
    const rawHrefs = $("a[href]")
      .map((_, el) => $(el).attr("href") ?? "")
      .get();
    const contactHrefs = rawHrefs
      .filter((href) => /^(?:mailto|tel):/i.test(href))
      .map((href) => safeDecode(href.replace(/^(?:mailto|tel):/i, "").split("?")[0] ?? ""));
    const anchors = rawHrefs
      .map((href) => normalizeUrl(href, url))
      .filter((href): href is string => Boolean(href));
    $("script,style,noscript,nav,footer,form,menu,iframe,svg,canvas,[role=navigation],[role=banner],[role=dialog],.cookie,.cookies,.cookie-banner,.advertisement,.ads,.modal").remove();
    const title = $("title").first().text().replace(/\s+/g, " ").trim();
    const description = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const publishedDate = $('meta[property="article:published_time"]').attr("content") ?? $("time[datetime]").first().attr("datetime");
    const headings = unique($("h1,h2,h3").map((_, el) => $(el).text().replace(/\s+/g, " ")).get()).slice(0, 50);
    const root = $("main,article,[role=main]").first(); const content = root.length ? root : $("body");
    const tableText = content.find("table").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter((text) => text.length > 20).slice(0, 10);
    const text = unique([...content.find("p,li,dd,dt").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get(), ...tableText]).join("\n").slice(0, 250_000);
    const source = `${description}\n${headings.join("\n")}\n${text}\n${structured}\n${contactHrefs.join("\n")}`;
    return {
      url,
      title,
      description,
      headings,
      text,
      publishedDate,
      signals: extractDirectSignals(source, anchors),
    };
  }
}
