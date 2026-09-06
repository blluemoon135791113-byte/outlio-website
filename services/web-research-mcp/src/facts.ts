import { extractDirectSignals } from "./parser.js";
import type { Lead, ResearchFact, ResearchOutput, ScoredPage, SearchResult } from "./types.js";

const canonical = (value: unknown) => JSON.stringify(value, Object.keys((value && typeof value === "object" && !Array.isArray(value)) ? value as object : {}).sort()).toLowerCase();

const GENERIC_MAILBOXES = new Set(["admin", "billing", "careers", "contact", "hello", "info", "jobs", "legal", "office", "privacy", "sales", "support", "team"]);

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function normalizedDomain(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.split(":")[0] ?? "";
}

function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function nameTokens(lead: Lead): string[] {
  return words(lead.name);
}

function mentionsPerson(text: string, lead: Lead): boolean {
  const haystack = words(text);
  const wanted = nameTokens(lead);
  if (wanted.length === 0) return false;
  if (wanted.length === 1) return haystack.includes(wanted[0]!);

  // Middle names are frequently omitted and a captured surname can be only an
  // initial. Require the first and last identity anchors; initials match the
  // first letter of a published token, but never an arbitrary substring.
  const anchors = [wanted[0]!, wanted.at(-1)!];
  return anchors.every((token) => token.length === 1
    ? haystack.some((candidate) => candidate.startsWith(token))
    : haystack.includes(token));
}

function mentionsCompany(text: string, lead: Lead, sourceUrl: string): boolean {
  const compact = words(text).join("");
  const company = words(lead.company).join("");
  const domain = normalizedDomain(lead.company_domain);
  const host = hostOf(sourceUrl);
  return Boolean(
    (company.length > 2 && compact.includes(company)) ||
    (domain && (text.toLowerCase().includes(domain) || host === domain || host.endsWith(`.${domain}`))),
  );
}

function localPartMatchesName(email: string, lead: Lead): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const compact = local.replace(/[^a-z0-9]/g, "");
  if (GENERIC_MAILBOXES.has(compact)) return false;
  const tokens = nameTokens(lead).filter((token) => token.length > 1);
  if (tokens.length === 0) return false;
  const first = tokens[0] ?? "";
  const last = tokens.at(-1) ?? "";
  const candidates = new Set([
    ...tokens,
    `${first}${last}`,
    `${first[0] ?? ""}${last}`,
    `${first}${last[0] ?? ""}`,
  ].filter((candidate) => candidate.length >= 3));
  return [...candidates].some((candidate) => compact === candidate || compact.startsWith(candidate));
}

function contactNearPerson(text: string, contact: string, lead: Lead): boolean {
  const lower = text.toLowerCase();
  const contactAt = lower.indexOf(contact.toLowerCase());
  if (contactAt < 0) return false;
  const boundaryBefore = Math.max(
    lower.lastIndexOf("\n", contactAt),
    lower.lastIndexOf(". ", contactAt),
    lower.lastIndexOf("! ", contactAt),
    lower.lastIndexOf("? ", contactAt),
  );
  const boundaryAfter = ["\n", ". ", "! ", "? "]
    .map((boundary) => lower.indexOf(boundary, contactAt + contact.length))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(boundaryBefore + 1, contactAt - 260);
  const end = Math.min(boundaryAfter ?? lower.length, contactAt + contact.length + 260);
  return mentionsPerson(lower.slice(start, end), lead);
}

function socialBelongsToPerson(url: string, lead: Lead): boolean {
  try {
    const parsed = new URL(url);
    const path = words(`${parsed.hostname} ${parsed.pathname}`).join("");
    const tokens = nameTokens(lead).filter((token) => token.length > 1);
    return tokens.length > 0 && tokens.every((token) => path.includes(token));
  } catch {
    return false;
  }
}

type ContactEvidence = { emails: string[]; phones: string[]; socialProfiles: string[] };

/**
 * Attribute public contacts to a person only when the source names the person
 * and employer, and the mailbox/nearby context supports the association.
 * This intentionally rejects generic company mailboxes and never verifies a
 * contact merely because a search engine published it.
 */
export function attributedPersonContacts(
  text: string,
  sourceUrl: string,
  lead: Lead,
  compactSource = false,
): ContactEvidence {
  const signals = extractDirectSignals(text, [sourceUrl]);
  const personMentioned = mentionsPerson(text, lead);
  const companyMentioned = mentionsCompany(text, lead, sourceUrl);
  const officialDomain = normalizedDomain(lead.company_domain);

  const emails = signals.emails.filter((email) => {
    const emailDomain = normalizedDomain(email.split("@")[1] ?? "");
    const domainMatches = Boolean(officialDomain && (emailDomain === officialDomain || emailDomain.endsWith(`.${officialDomain}`)));
    return personMentioned && companyMentioned && localPartMatchesName(email, lead) &&
      (domainMatches || contactNearPerson(text, email, lead));
  });
  const phones = signals.phones.filter((phone) =>
    personMentioned && companyMentioned && (compactSource || contactNearPerson(text, phone, lead)),
  );
  const socialProfiles = signals.social_links.filter((url) => socialBelongsToPerson(url, lead));
  return { emails, phones, socialProfiles };
}

export class ConfidenceScorer {
  deterministic(page: ScoredPage, lead: Lead): ResearchFact[] {
    const base = Math.min(.98, .7 + page.sourceQuality * .15 + page.relevance * .13);
    const source = `${page.title}\n${page.description}\n${page.headings.join("\n")}\n${page.text}`;
    const contacts = attributedPersonContacts(source, page.url, lead);
    return [
      ...contacts.emails.map((value) => ({ field: "person.emails", value, contact_status: "publicly_found" as const })),
      ...contacts.phones.map((value) => ({ field: "person.phones", value, contact_status: "publicly_found" as const })),
      ...contacts.socialProfiles.map((value) => ({ field: "person.social_profiles", value })),
    ].map((fact) => ({ ...fact, source_url: page.url, source_title: page.title, published_date: page.publishedDate ?? null, confidence: base }));
  }

  snippet(result: SearchResult, lead: Lead): ResearchFact[] {
    const source = `${result.title}\n${result.snippet}`;
    const contacts = attributedPersonContacts(source, result.url, lead, true);
    const domain = normalizedDomain(lead.company_domain);
    const host = hostOf(result.url);
    const official = Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
    const base = Math.min(.86, .62 + (official ? .12 : 0) + Math.max(0, .06 - (result.rank - 1) * .01));
    return [
      ...contacts.emails.map((value) => ({ field: "person.emails", value, contact_status: "publicly_found" as const })),
      ...contacts.phones.map((value) => ({ field: "person.phones", value, contact_status: "publicly_found" as const })),
      ...contacts.socialProfiles.map((value) => ({ field: "person.social_profiles", value })),
    ].map((fact) => ({
      ...fact,
      source_url: result.url,
      source_title: result.title,
      published_date: null,
      confidence: base,
    }));
  }
}

export class FactMerger {
  merge(facts: ResearchFact[], pages: ScoredPage[], meta: Record<string, unknown>): ResearchOutput {
    const unique = new Map<string, ResearchFact>(); const hosts = new Map<string, Set<string>>();
    for (const fact of facts) {
      const key = `${fact.field}:${canonical(fact.value)}`; const host = new URL(fact.source_url).hostname;
      const sources = hosts.get(key) ?? new Set<string>(); sources.add(host); hosts.set(key, sources);
      const existing = unique.get(key);
      if (!existing || fact.confidence > existing.confidence) unique.set(key, fact);
    }
    for (const [key, fact] of unique) { const count = hosts.get(key)?.size ?? 1; if (count > 1) fact.confidence = Math.min(.99, fact.confidence + Math.min(.18, (count - 1) * .08)); }
    const valuesByField = new Map<string, string[]>();
    for (const fact of unique.values()) { const values = valuesByField.get(fact.field) ?? []; if (!values.includes(canonical(fact.value))) values.push(canonical(fact.value)); valuesByField.set(fact.field, values); }
    for (const fact of unique.values()) if ((valuesByField.get(fact.field)?.length ?? 0) > 1 && !["person.emails", "person.phones", "person.social_profiles", "company.tech_stack", "company.competitors"].includes(fact.field)) fact.conflict_group = fact.field;
    const finalFacts = [...unique.values()].sort((a, b) => b.confidence - a.confidence);
    const person: Record<string, unknown> = {}; const company: Record<string, unknown> = {}; const signals: Record<string, unknown> = {};
    for (const fact of finalFacts) {
      const [root, ...path] = fact.field.split("."); const key = path.join(".") || fact.field; const target = root === "person" ? person : root === "company" ? company : signals;
      const current = target[key]; target[key] = current === undefined ? fact.value : Array.isArray(current) ? [...current, fact.value] : [current, fact.value];
    }
    return {
      person,
      company,
      signals,
      facts: finalFacts,
      sources: pages.map((page) => ({
        url: page.url,
        title: page.title,
        relevance: page.relevance,
        published_date: page.publishedDate,
      })),
      documents: pages.map((page) => ({
        url: page.url,
        title: page.title,
        description: page.description,
        headings: page.headings,
        text: page.text,
        signals: page.signals,
        published_date: page.publishedDate,
        relevance: page.relevance,
        source_quality: page.sourceQuality,
      })),
      meta,
    };
  }
}
