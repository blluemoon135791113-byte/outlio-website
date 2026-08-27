import type { Lead } from "./types.js";

function unquoted(value: string): string {
  return value.replaceAll('"', '').replace(/\s+/g, " ").trim();
}

export class QueryGenerator {
  generate(lead: Lead, requestedFields: string[], max: number): string[] {
    const name = unquoted(lead.name);
    const employer = unquoted(lead.company);
    const jobTitle = unquoted(lead.job_title);
    const person = `"${name}" "${employer}"`;
    const company = lead.company_domain ? `"${employer}" site:${lead.company_domain}` : `"${employer}"`;
    const broadIdentity = `${name} ${lead.company_domain || employer}`;
    const fieldSet = new Set(requestedFields);
    const wantsEmail = fieldSet.has("work_email") || fieldSet.has("email_status") || fieldSet.has("emails");
    const wantsPhone = fieldSet.has("mobile_phone") || fieldSet.has("phone_status") || fieldSet.has("phones");
    const requested = [...new Set(requestedFields.map((field) => field.replaceAll("_", " ")))].slice(0, 8).join(" ");

    // Contact tasks are different from general company research: ordinary
    // search engines surface public contact details most reliably for an exact
    // person + employer-domain query. Put those searches inside the caller's
    // contact-query budget instead of hiding them behind one generic query.
    const emailQueries = wantsEmail ? [
        `${broadIdentity} email`,
        lead.company_domain
          ? `site:${lead.company_domain} "${name}" email`
          : `${person} work email`,
        `${person} contact email`,
        `${person} filetype:pdf email`,
      ] : [];
    const phoneQueries = wantsPhone ? [
        `${broadIdentity} phone WhatsApp`,
        lead.company_domain
          ? `site:${lead.company_domain} "${name}" phone`
          : `${person} phone contact`,
        `${person} contact phone`,
        `${person} filetype:pdf phone`,
      ] : [];
    const contactQueries = [
      ...emailQueries.slice(0, 2),
      ...phoneQueries.slice(0, 2),
      ...emailQueries.slice(2),
      ...phoneQueries.slice(2),
      ...(jobTitle && (wantsEmail || wantsPhone)
        ? [`"${name}" "${jobTitle}" "${employer}"`]
        : []),
    ];

    const generalQueries = [
      `${person} role profile leadership`,
      `${company} about product technology customers hiring`,
      `${company} revenue funding investors recent news growth`,
      `${company} competitors reviews pain points`,
    ];
    if (!wantsEmail && !wantsPhone) generalQueries.splice(1, 0, `${person} email phone contact`);
    if (requested && !wantsEmail && !wantsPhone) generalQueries.splice(2, 0, `${company} ${requested}`);
    return [...new Set([...contactQueries, ...generalQueries].map((query) => query.trim()))].slice(0, max);
  }
}
