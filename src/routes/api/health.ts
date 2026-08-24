import { createServerFn } from "@tanstack/react-start";
import { ensureSchema, listArvoTables } from "~/db/schema";
import { requireEnv } from "~/db/connection";

export interface HealthResult {
  ok: boolean;
  schema: boolean;
  tables: string[];
  error?: string;
}

/**
 * Healthcheck server function: proves DB connectivity by running ensureSchema()
 * (self-heals a fresh DB) and listing the resulting `arvo` tables.
 */
export const getHealth = createServerFn().handler(async (): Promise<HealthResult> => {
  try {
    requireEnv("databaseUrl");
    await ensureSchema();
    const tables = await listArvoTables();
    return { ok: true, schema: true, tables };
  } catch (error) {
    return {
      ok: false,
      schema: false,
      tables: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

export const getConfigSummary = createServerFn().handler(async () => ({
  appBaseUrl: process.env.APP_BASE_URL || "",
  hasDatabase: Boolean(process.env.DATABASE_URL),
}));
