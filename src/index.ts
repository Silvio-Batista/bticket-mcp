#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BticketClient } from "./bticket/client.js";
import { loadConfig } from "./config.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new BticketClient(config);
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  console.error(`${SERVER_NAME} ${SERVER_VERSION} stdio`);
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
