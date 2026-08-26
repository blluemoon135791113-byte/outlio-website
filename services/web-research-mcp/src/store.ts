import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { ResearchJob, ResearchOutput, ResearchRequest } from "./types.js";

export interface ResearchStorage {
  initialize(): Promise<void>; create(request: ResearchRequest): Promise<ResearchJob>; get(id: string): Promise<ResearchJob | null>;
  claim(): Promise<ResearchJob | null>; complete(id: string, output: ResearchOutput): Promise<void>; fail(id: string, code: string, message: string): Promise<void>;
  cacheGet<T>(namespace: string, key: string): Promise<T | null>; cacheSet(namespace: string, key: string, value: unknown, ttlSeconds: number): Promise<void>;
  latest(tenantId: string, leadId: string): Promise<ResearchOutput | null>;
}

export class MemoryResearchStorage implements ResearchStorage {
  private jobs = new Map<string, ResearchJob>();
  private cache = new Map<string, { value: unknown; expires: number }>();
  private leadResults = new Map<string, ResearchOutput>();
  async initialize() {}
  async create(request: ResearchRequest) { const now = new Date().toISOString(); const job: ResearchJob = { id: randomUUID(), status: "queued", request, createdAt: now, updatedAt: now }; this.jobs.set(job.id, job); return structuredClone(job); }
  async get(id: string) { const job = this.jobs.get(id); return job ? structuredClone(job) : null; }
  async claim() { const job = [...this.jobs.values()].find((item) => item.status === "queued"); if (!job) return null; job.status = "running"; job.updatedAt = new Date().toISOString(); return structuredClone(job); }
  async complete(id: string, output: ResearchOutput) { const job = this.jobs.get(id); if (!job) return; job.status = "completed"; job.output = output; job.updatedAt = new Date().toISOString(); if (job.request.tenant_id && job.request.lead_id) this.leadResults.set(`${job.request.tenant_id}:${job.request.lead_id}`, structuredClone(output)); }
  async fail(id: string, code: string, message: string) { const job = this.jobs.get(id); if (!job) return; job.status = "failed"; job.error = { code, message }; job.updatedAt = new Date().toISOString(); }
  async cacheGet<T>(namespace: string, key: string) { const item = this.cache.get(`${namespace}:${key}`); if (!item || item.expires <= Date.now()) return null; return structuredClone(item.value) as T; }
  async cacheSet(namespace: string, key: string, value: unknown, ttlSeconds: number) { this.cache.set(`${namespace}:${key}`, { value: structuredClone(value), expires: Date.now() + ttlSeconds * 1000 }); }
  async latest(tenantId: string, leadId: string) { return structuredClone(this.leadResults.get(`${tenantId}:${leadId}`) ?? null); }
}

export class PostgresResearchStorage implements ResearchStorage {
  private readonly pool: Pool;
  constructor(connectionString: string, sslMode: "disable" | "require" | "verify-full" = "require") { this.pool = new Pool({ connectionString, max: 10, ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify-full" } }); }
  async initialize() { await this.pool.query(`CREATE TABLE IF NOT EXISTS web_research_jobs (id uuid PRIMARY KEY, status text NOT NULL CHECK (status IN ('queued','running','completed','failed')), request jsonb NOT NULL, output jsonb, error jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`); await this.pool.query(`CREATE INDEX IF NOT EXISTS web_research_jobs_status_created_idx ON web_research_jobs(status, created_at)`); await this.pool.query(`CREATE TABLE IF NOT EXISTS web_research_cache (namespace text NOT NULL, cache_key text NOT NULL, value jsonb NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(namespace,cache_key))`); await this.pool.query(`CREATE TABLE IF NOT EXISTS web_research_lead_results (tenant_id uuid NOT NULL, lead_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES web_research_jobs(id), output jsonb NOT NULL, researched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,lead_id))`); }
  async create(request: ResearchRequest) { const id = randomUUID(); const { rows } = await this.pool.query("INSERT INTO web_research_jobs (id,status,request) VALUES ($1,'queued',$2) RETURNING *", [id, request]); return rowToJob(rows[0]); }
  async get(id: string) { const { rows } = await this.pool.query("SELECT * FROM web_research_jobs WHERE id=$1", [id]); return rows[0] ? rowToJob(rows[0]) : null; }
  async claim(): Promise<ResearchJob | null> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const { rows } = await client.query("SELECT * FROM web_research_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"); if (!rows[0]) { await client.query("COMMIT"); return null; } await client.query("UPDATE web_research_jobs SET status='running',updated_at=now() WHERE id=$1", [rows[0].id]); await client.query("COMMIT"); return { ...rowToJob(rows[0]), status: "running" }; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async complete(id: string, output: ResearchOutput) { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE web_research_jobs SET status='completed',output=$2,updated_at=now() WHERE id=$1", [id, output]); await client.query(`INSERT INTO web_research_lead_results(tenant_id,lead_id,job_id,output) SELECT (request->>'tenant_id')::uuid,(request->>'lead_id')::uuid,id,$2 FROM web_research_jobs WHERE id=$1 AND request ? 'tenant_id' AND request ? 'lead_id' ON CONFLICT(tenant_id,lead_id) DO UPDATE SET job_id=EXCLUDED.job_id,output=EXCLUDED.output,researched_at=now()`, [id, output]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async fail(id: string, code: string, message: string) { await this.pool.query("UPDATE web_research_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1", [id, { code, message }]); }
  async cacheGet<T>(namespace: string, key: string) { const { rows } = await this.pool.query("SELECT value FROM web_research_cache WHERE namespace=$1 AND cache_key=$2 AND expires_at > now()", [namespace, key]); return rows[0] ? rows[0].value as T : null; }
  async cacheSet(namespace: string, key: string, value: unknown, ttlSeconds: number) { await this.pool.query("INSERT INTO web_research_cache(namespace,cache_key,value,expires_at) VALUES($1,$2,$3,now()+($4 * interval '1 second')) ON CONFLICT(namespace,cache_key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at", [namespace, key, value, ttlSeconds]); }
  async latest(tenantId: string, leadId: string) { const { rows } = await this.pool.query("SELECT output FROM web_research_lead_results WHERE tenant_id=$1 AND lead_id=$2", [tenantId, leadId]); return rows[0] ? rows[0].output as ResearchOutput : null; }
}

function rowToJob(row: Record<string, unknown>): ResearchJob { return { id: String(row.id), status: row.status as ResearchJob["status"], request: row.request as ResearchRequest, output: row.output as ResearchOutput | undefined, error: row.error as ResearchJob["error"], createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString() }; }
