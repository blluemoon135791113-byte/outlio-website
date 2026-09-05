import { z } from "zod";

export const LeadSchema = z.object({
  name: z.string().trim().min(1),
  job_title: z.string().trim().default(""),
  company: z.string().trim().min(1),
  company_domain: z.string().trim().default(""),
  linkedin_url: z.string().trim().default(""),
});
export type Lead = z.infer<typeof LeadSchema>;

export const RequestedLimitsSchema = z.object({
  max_queries: z.number().int().positive().optional(),
  results_per_query: z.number().int().positive().optional(),
  max_urls: z.number().int().positive().optional(),
  max_gemini_calls: z.number().int().nonnegative().optional(),
}).optional();

export const ResearchRequestSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  lead: LeadSchema,
  requested_fields: z.array(z.string().trim().min(1)).max(30).default([]),
  limits: RequestedLimitsSchema,
}).refine((value) => Boolean(value.tenant_id) === Boolean(value.lead_id), { message: "tenant_id and lead_id must be supplied together" });
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

export type SearchResult = { query: string; title: string; url: string; snippet: string; rank: number };
export type DirectSignals = {
  emails: string[]; phones: string[]; urls: string[]; dates: string[];
  currencies: string[]; social_links: string[];
};
export type ParsedPage = {
  url: string; title: string; description: string; headings: string[];
  text: string; signals: DirectSignals; publishedDate?: string;
};
export type ScoredPage = ParsedPage & { query: string; rank: number; relevance: number; sourceQuality: number };

export const FactSchema = z.object({
  field: z.string(), value: z.unknown(), source_url: z.string().url(), source_title: z.string(),
  published_date: z.string().nullable(), confidence: z.number().min(0).max(1),
  contact_status: z.enum(["verified", "publicly_found", "inferred", "not_found"]).optional(),
  conflict_group: z.string().optional(),
});
export type ResearchFact = z.infer<typeof FactSchema>;

export type ResearchOutput = {
  person: Record<string, unknown>; company: Record<string, unknown>;
  signals: Record<string, unknown>; facts: ResearchFact[];
  sources: Array<{ url: string; title: string; relevance: number; published_date?: string }>;
  /**
   * Cleaned evidence for Hubble's company-level page/chunk store.
   * Raw HTML is deliberately never returned or persisted.
   */
  documents: Array<{
    url: string; title: string; description: string; headings: string[];
    text: string; signals: DirectSignals; published_date?: string;
    relevance: number; source_quality: number;
  }>;
  meta: Record<string, unknown>;
};

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type ResearchJob = {
  id: string; status: JobStatus; request: ResearchRequest; output?: ResearchOutput;
  error?: { code: string; message: string }; createdAt: string; updatedAt: string;
};

export class ResearchError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
