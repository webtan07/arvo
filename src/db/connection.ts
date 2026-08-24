import { neon } from "@neondatabase/serverless";

export interface ArvoConfig {
  databaseUrl?: string;
  appBaseUrl: string;
  port: number;
}

export function loadConfig(): ArvoConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
    appBaseUrl:
      process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || "3102"}`,
    port: Number(process.env.PORT) || 3102,
  };
}

export const config = loadConfig();

export function requireEnv(name: keyof ArvoConfig): string {
  const value = config[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env and fill it in.`);
  }
  return value as string;
}

/**
 * Shared Neon serverless Postgres access. Every query targets the dedicated
 * `arvo` schema so it stays cleanly separated from the other apps (fed, public)
 * sharing the same Neon account/database.
 */
export const sql = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env and add the Neon connection string.",
    );
  }
  return neon(url);
};
