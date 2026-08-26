import { z } from "zod";
import type { Config } from "./config.js";
import type { Lead, ResearchFact, ScoredPage } from "./types.js";
import { ResearchError } from "./types.js";

const ExtractionSchema = z.object({ facts: z.array(z.object({
  field: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]), confidence: z.number().min(0).max(1),
})).max(60) });

export interface SemanticExtractor { extract(lead: Lead, page: ScoredPage, chunk: string): Promise<ResearchFact[]>; }

export class GeminiExtractor implements SemanticExtractor {
  constructor(private readonly config: Config, private readonly fetchImpl: typeof fetch = fetch) {}
  async extract(lead: Lead, page: ScoredPage, chunk: string): Promise<ResearchFact[]> {
    if (!this.config.GEMINI_API_KEY) return [];
    const prompt = `Extract only facts explicitly supported by SOURCE. Do not infer or guess emails or phone numbers. Return JSON {"facts":[{"field":"company.industry","value":"...","confidence":0.0}]}.
Allowed themes: person role/location; company industry/employee_count/revenue/funding/investors/technology/customers/competitors; recent_news/hiring/growth/buying_signals/pain_points/personalization_points.
LEAD: ${JSON.stringify(lead)}\nSOURCE URL: ${page.url}\nSOURCE:\n${chunk}`;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.REQUEST_TIMEOUT_MS * 2);
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(this.config.GEMINI_API_KEY)}`;
      const response = await this.fetchImpl(endpoint, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }) });
      if (!response.ok) throw new ResearchError("GEMINI_ERROR", `Gemini returned HTTP ${response.status}`, response.status === 429 || response.status >= 500);
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = body.candidates?.[0]?.content?.parts?.[0]?.text; if (!raw) return [];
      const parsed = ExtractionSchema.parse(JSON.parse(raw));
      return parsed.facts.map((fact) => ({ ...fact, source_url: page.url, source_title: page.title, published_date: page.publishedDate ?? null, confidence: Math.min(.98, fact.confidence * page.relevance * (.65 + .35 * page.sourceQuality)) }));
    } catch (error) { if (error instanceof ResearchError) throw error; throw new ResearchError("GEMINI_ERROR", error instanceof Error ? error.message : "Gemini extraction failed", true); }
    finally { clearTimeout(timer); }
  }
}
