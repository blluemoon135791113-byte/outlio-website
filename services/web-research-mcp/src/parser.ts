import * as cheerio from "cheerio";
import type { ParsedPage } from "./types.js";
import { normalizeUrl } from "./url.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d().\s-]{7,}\d)(?!\d)/g;
const DATE = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})\b/gi;
const CURRENCY = /(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|m|bn))?|\d[\d,.]*\s?(?:USD|EUR|GBP))/gi;

function unique(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()).filter(Boolean))]; }

export class CheerioParser {
  parse(url: string, html: string): ParsedPage {
    const $ = cheerio.load(html);
    $("script,style,noscript,nav,footer,form,menu,iframe,svg,canvas,[role=navigation],[role=banner],[role=dialog],.cookie,.cookies,.cookie-banner,.advertisement,.ads,.modal").remove();
    const title = $("title").first().text().replace(/\s+/g, " ").trim();
    const description = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const publishedDate = $('meta[property="article:published_time"]').attr("content") ?? $("time[datetime]").first().attr("datetime");
    const headings = unique($("h1,h2,h3").map((_, el) => $(el).text().replace(/\s+/g, " ")).get()).slice(0, 50);
    const root = $("main,article,[role=main]").first(); const content = root.length ? root : $("body");
    const tableText = content.find("table").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter((text) => text.length > 20).slice(0, 10);
    const text = unique([...content.find("p,li,dd,dt").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get(), ...tableText]).join("\n").slice(0, 250_000);
    const anchors = $("a[href]").map((_, el) => normalizeUrl($(el).attr("href") ?? "", url)).get();
    const socials = anchors.filter((link) => /(?:linkedin|twitter|x|facebook|instagram|github)\.com/i.test(link));
    const source = `${description}\n${headings.join("\n")}\n${text}`;
    return { url, title, description, headings, text, publishedDate, signals: {
      emails: unique(source.match(EMAIL) ?? []).filter((email) => !/\.(png|jpg|jpeg|gif|webp)$/i.test(email)),
      phones: unique(source.match(PHONE) ?? []).filter((phone) => phone.replace(/\D/g, "").length >= 8),
      urls: unique(anchors), dates: unique(source.match(DATE) ?? []), currencies: unique(source.match(CURRENCY) ?? []), social_links: unique(socials),
    }};
  }
}
