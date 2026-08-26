import type { ResearchFact, ResearchOutput, ScoredPage } from "./types.js";

const canonical = (value: unknown) => JSON.stringify(value, Object.keys((value && typeof value === "object" && !Array.isArray(value)) ? value as object : {}).sort()).toLowerCase();

export class ConfidenceScorer {
  deterministic(page: ScoredPage): ResearchFact[] {
    const base = Math.min(.98, .7 + page.sourceQuality * .15 + page.relevance * .13);
    return [
      ...page.signals.emails.map((value) => ({ field: "person.emails", value, contact_status: "publicly_found" as const })),
      ...page.signals.phones.map((value) => ({ field: "person.phones", value, contact_status: "publicly_found" as const })),
      ...page.signals.social_links.map((value) => ({ field: "person.social_profiles", value })),
    ].map((fact) => ({ ...fact, source_url: page.url, source_title: page.title, published_date: page.publishedDate ?? null, confidence: base }));
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
    return { person, company, signals, facts: finalFacts, sources: pages.map((page) => ({ url: page.url, title: page.title, relevance: page.relevance, published_date: page.publishedDate })), meta };
  }
}
