import type { Lead, ParsedPage } from "./types.js";

const QUALITY: Array<[RegExp, number]> = [[/\.gov(?:\.|$)/, 1], [/\.edu(?:\.|$)/, .9], [/(reuters|apnews|bloomberg|ft\.com|wsj\.com|sec\.gov)/, .9], [/(crunchbase|techcrunch)/, .72], [/(medium|blogspot)/, .45]];
const includes = (text: string, value: string) => value.length > 1 && text.includes(value.toLowerCase());

export class RelevanceScorer {
  score(page: ParsedPage, lead: Lead, query: string, rank: number) {
    const text = `${page.url} ${page.title} ${page.description} ${page.headings.join(" ")} ${page.text.slice(0, 20_000)}`.toLowerCase();
    const host = new URL(page.url).hostname; const domain = lead.company_domain.toLowerCase().replace(/^www\./, "");
    const person = includes(text, lead.name); const company = includes(text, lead.company); const domainMatch = Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
    const title = includes(text, lead.job_title); const terms = query.toLowerCase().replaceAll('"', "").split(/\s+/).filter((term) => term.length > 2);
    const querySimilarity = terms.length ? terms.filter((term) => text.includes(term)).length / terms.length : 0;
    const sourceQuality = domainMatch ? 1 : (QUALITY.find(([pattern]) => pattern.test(host))?.[1] ?? .58);
    const binding = person || company || domainMatch;
    const relevance = binding ? Math.min(1, (person ? .2 : 0) + (company ? .22 : 0) + (domainMatch ? .23 : 0) + (title ? .1 : 0) + querySimilarity * .1 + (1 / Math.max(1, rank)) * .06 + sourceQuality * .09) : 0;
    return { relevance: Number(relevance.toFixed(3)), sourceQuality };
  }
}
