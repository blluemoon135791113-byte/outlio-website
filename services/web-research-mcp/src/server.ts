import { timingSafeEqual } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CachingPageFetcher, CachingSearchProvider, CachingSemanticExtractor } from "./cache.js";
import { loadConfig } from "./config.js";
import { PageFetcher } from "./fetcher.js";
import { GeminiExtractor } from "./gemini.js";
import { LeadResearchPipeline } from "./pipeline.js";
import { DuckDuckGoHtmlSearchProvider } from "./search.js";
import { MemoryResearchStorage, PostgresResearchStorage, SupabaseResearchStorage, type ResearchStorage } from "./store.js";
import { ResearchError, ResearchRequestSchema } from "./types.js";

const config = loadConfig();
const storage: ResearchStorage = config.DATABASE_URL
  ? new PostgresResearchStorage(config.DATABASE_URL, config.DATABASE_SSL_MODE)
  : config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseResearchStorage(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryResearchStorage();
const storageName = config.DATABASE_URL ? "postgres" : config.SUPABASE_URL ? "supabase-rest" : "memory";
await storage.initialize();
const searchProvider = new CachingSearchProvider(new DuckDuckGoHtmlSearchProvider(config), storage, config);
const pipeline = new LeadResearchPipeline(config, searchProvider, new CachingPageFetcher(new PageFetcher(config), storage, config), new CachingSemanticExtractor(new GeminiExtractor(config), storage, config));

function secureEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!config.MCP_BEARER_TOKEN) { if (config.NODE_ENV !== "production") return next(); res.status(503).json({ error: "Authentication is not configured" }); return; }
  const header = req.header("authorization") ?? ""; const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secureEqual(token, config.MCP_BEARER_TOKEN)) { res.setHeader("WWW-Authenticate", "Bearer"); res.status(401).json({ error: "Invalid bearer token" }); return; }
  next();
}

const mcp = new McpServer({ name: "outlio-web-research", version: "0.1.0" });
const WebSearchInput = z.object({ query: z.string().trim().min(1).max(400), limit: z.number().int().min(1).max(20).default(8) });
mcp.registerTool("web_search", { title: "Search the public web", description: "Return normalized DuckDuckGo HTML result metadata. A provider challenge fails closed and is never bypassed.", inputSchema: WebSearchInput }, async ({ query, limit }) => {
  const results = await searchProvider.search(query, limit); const response = { provider: "duckduckgo-html", results }; return { content: [{ type: "text", text: JSON.stringify(response) }], structuredContent: response };
});
const StartInput = ResearchRequestSchema;
mcp.registerTool("research_start", { title: "Start lead research", description: "Queue public-web research for one B2B lead. Returns immediately with a job ID.", inputSchema: StartInput }, async (input) => {
  if (config.WORKER_MODE === "request") {
    const response = { code: "BACKGROUND_WORKER_DISABLED", message: "This deployment uses request-bound processing. Call research_run instead." };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(response) }], structuredContent: response };
  }
  const job = await storage.create(ResearchRequestSchema.parse(input)); return { content: [{ type: "text", text: JSON.stringify({ job_id: job.id, status: job.status }) }], structuredContent: { job_id: job.id, status: job.status } };
});
mcp.registerTool("research_run", { title: "Run lead research", description: "Run bounded public-web research inside this request and persist the completed result. Intended for free hosts without an always-on worker.", inputSchema: StartInput }, async (input) => {
  const request = ResearchRequestSchema.parse(input);
  const job = await storage.create(request);
  try {
    const output = await pipeline.run(request);
    await storage.complete(job.id, output);
    const response = { job_id: job.id, status: "completed" as const, result: output };
    return { content: [{ type: "text", text: JSON.stringify(response) }], structuredContent: response };
  } catch (error) {
    const code = error instanceof ResearchError ? error.code : "RESEARCH_FAILED";
    const message = error instanceof Error ? error.message : "Research failed";
    await storage.fail(job.id, code, message);
    const response = { job_id: job.id, status: "failed" as const, error: { code, message } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(response) }], structuredContent: response };
  }
});
const JobInput = z.object({ job_id: z.string().uuid() });
mcp.registerTool("research_status", { title: "Check research status", inputSchema: JobInput }, async ({ job_id }) => {
  const job = await storage.get(job_id); const result = job ? { job_id, status: job.status, error: job.error } : { job_id, status: "not_found" }; return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
});
mcp.registerTool("research_result", { title: "Get research result", inputSchema: JobInput }, async ({ job_id }) => {
  const job = await storage.get(job_id); const result = job ? { job_id, status: job.status, result: job.output, error: job.error } : { job_id, status: "not_found" }; return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
});
const LeadResultInput = z.object({ tenant_id: z.string().uuid(), lead_id: z.string().uuid() });
mcp.registerTool("research_latest", { title: "Get stored lead research", description: "Return the latest completed research stored for one tenant-scoped Outlio lead.", inputSchema: LeadResultInput }, async ({ tenant_id, lead_id }) => {
  const result = await storage.latest(tenant_id, lead_id); const response = { tenant_id, lead_id, status: result ? "completed" : "not_found", result }; return { content: [{ type: "text", text: JSON.stringify(response) }], structuredContent: response };
});

let stopping = false;
async function worker() {
  while (!stopping) {
    const job = await storage.claim();
    if (!job) { await new Promise((resolve) => setTimeout(resolve, 750)); continue; }
    try { await storage.complete(job.id, await pipeline.run(job.request)); }
    catch (error) { const code = error instanceof ResearchError ? error.code : "RESEARCH_FAILED"; await storage.fail(job.id, code, error instanceof Error ? error.message : "Research failed"); }
  }
}
if (config.WORKER_MODE === "background") void worker();

const bindHost = config.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const app = createMcpExpressApp({ host: bindHost, jsonLimit: "1mb" });
app.get("/health", (_req, res) => res.json({ status: "ok", storage: storageName, gemini: Boolean(config.GEMINI_API_KEY), worker_mode: config.WORKER_MODE }));
app.post("/mcp", authenticate, async (req, res) => { const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined }); await mcp.connect(transport); await transport.handleRequest(req, res, req.body); });
app.all("/mcp", authenticate, (_req, res) => res.status(405).setHeader("Allow", "POST").json({ error: "Stateless MCP endpoint accepts POST only" }));
const listener = app.listen(config.PORT, bindHost, () => console.log(JSON.stringify({ event: "server_started", port: config.PORT })));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; listener.close(() => process.exit(0)); });
