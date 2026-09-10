#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { BticketClient } from "./bticket/client.js";
import { loadConfig } from "./config.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

type SessionTransport = StreamableHTTPServerTransport | SSEServerTransport;

const transports = new Map<string, SessionTransport>();

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new BticketClient(config);
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, MCP-Session-Id, Last-Event-ID, Authorization",
    );
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transports: {
        streamableHttp: "/mcp",
        sse: "/sse",
        sseMessages: "/messages",
      },
    });
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        const existing = transports.get(sessionId);
        if (!(existing instanceof StreamableHTTPServerTransport)) {
          jsonRpcError(res, 400, "Sessão existe mas usa outro transporte");
          return;
        }
        transport = existing;
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };
        const server = createMcpServer(client);
        await server.connect(transport);
      } else {
        jsonRpcError(res, 400, "Sessão MCP inválida. Envie initialize em POST /mcp.");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Erro /mcp:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Erro interno no transporte Streamable HTTP");
      }
    }
  });

  app.get("/sse", async (_req: Request, res: Response) => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => {
        transports.delete(transport.sessionId);
      });
      const server = createMcpServer(client);
      await server.connect(transport);
    } catch (error) {
      console.error("Erro /sse:", error);
      if (!res.headersSent) {
        res.status(500).end("Erro ao abrir SSE");
      }
    }
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId ?? "");
    const existing = transports.get(sessionId);
    if (!(existing instanceof SSEServerTransport)) {
      res.status(400).send("Sessão SSE não encontrada");
      return;
    }
    await existing.handlePostMessage(req, res, req.body);
  });

  const host = "0.0.0.0";
  app.listen(config.port, host, () => {
    console.error(
      `${SERVER_NAME} HTTP em http://${host}:${config.port}  (Streamable HTTP: /mcp  SSE: /sse)`,
    );
  });

  const shutdown = async () => {
    for (const transport of transports.values()) {
      try {
        await transport.close();
      } catch (error) {
        console.error("Erro ao fechar transporte:", error);
      }
    }
    transports.clear();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
