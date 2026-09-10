import { config as loadEnv } from "dotenv";

loadEnv();

export type BticketConfig = {
  apiUrl: string;
  email?: string;
  password?: string;
  token?: string;
  port: number;
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadConfig(): BticketConfig {
  const apiUrl = optional("BTICKET_API_URL");
  if (!apiUrl) {
    throw new Error(
      "BTICKET_API_URL is required (ex.: https://bticket.brediweb.com.br)",
    );
  }

  const portRaw = optional("PORT") ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    apiUrl: trimSlash(apiUrl),
    email: optional("BTICKET_EMAIL"),
    password: optional("BTICKET_PASSWORD"),
    token: optional("BTICKET_TOKEN"),
    port,
  };
}
