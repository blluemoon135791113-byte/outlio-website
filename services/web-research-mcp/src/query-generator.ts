import type { Lead } from "./types.js";

export class QueryGenerator {
  generate(lead: Lead, requestedFields: string[], max: number): string[] {
    const person = `"${lead.name}" "${lead.company}"`;
    const company = lead.company_domain ? `"${lead.company}" site:${lead.company_domain}` : `"${lead.company}"`;
    const defaults = [person, `${person} email`, `${person} phone`, `${company} revenue`, `${company} funding`, `${company} hiring`, `${company} technology`, `${company} recent news`, `${company} competitors`, `${company} reviews`];
    const requested = requestedFields.map((field) => `${company} ${field.replaceAll("_", " ")}`);
    return [...new Set([...defaults, ...requested])].slice(0, max);
  }
}
