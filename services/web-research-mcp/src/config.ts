import { z } from "zod";

const optionalSecret = (schema: z.ZodString) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  schema.optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WORKER_MODE: z.enum(["background", "request"]).default("background"),
  MCP_BEARER_TOKEN: optionalSecret(z.string().min(24)), DATABASE_URL: optionalSecret(z.string().url()),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("require"),
  GEMINI_API_KEY: optionalSecret(z.string().min(10)), GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  MAX_QUERIES: z.coerce.number().int().min(1).max(30).default(10),
  RESULTS_PER_QUERY: z.coerce.number().int().min(1).max(20).default(8),
  MAX_URLS: z.coerce.number().int().min(1).max(100).default(25),
  CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(20).default(6),
  PER_DOMAIN_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(2),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  MAX_PAGE_BYTES: z.coerce.number().int().min(10000).max(10_000_000).default(2_000_000),
  RELEVANCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.42),
  MAX_GEMINI_CALLS: z.coerce.number().int().min(0).max(50).default(8),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(86400),
  DDG_MIN_INTERVAL_MS: z.coerce.number().int().min(250).default(1500),
});
export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = EnvSchema.parse(env);
  if (config.NODE_ENV === "production" && (!config.MCP_BEARER_TOKEN || !config.DATABASE_URL)) {
    throw new Error("Production requires MCP_BEARER_TOKEN and DATABASE_URL");
  }
  return config;
}

export function clampLimits(config: Config, requested?: Record<string, number | undefined>) {
  return {
    maxQueries: Math.min(config.MAX_QUERIES, requested?.max_queries ?? config.MAX_QUERIES),
    resultsPerQuery: Math.min(config.RESULTS_PER_QUERY, requested?.results_per_query ?? config.RESULTS_PER_QUERY),
    maxUrls: Math.min(config.MAX_URLS, requested?.max_urls ?? config.MAX_URLS),
    maxGeminiCalls: Math.min(config.MAX_GEMINI_CALLS, requested?.max_gemini_calls ?? config.MAX_GEMINI_CALLS),
  };
}
