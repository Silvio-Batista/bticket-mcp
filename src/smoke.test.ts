import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BticketClient } from "./bticket/client.js";
import { BticketApiError, extractBoardUuids, extractToken } from "./bticket/errors.js";
import { createMcpServer } from "./server.js";

type Incoming = http.IncomingMessage & { url?: string };

function readJson(req: Incoming): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function startMockApi(): Promise<{
  url: string;
  close: () => Promise<void>;
  calls: string[];
}> {
  const calls: string[] = [];
  let loginCount = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers.authorization ?? "";
    calls.push(`${req.method} ${url.pathname}`);

    if (req.method === "POST" && url.pathname === "/api/user/login") {
      loginCount += 1;
      const body = (await readJson(req)) as { email?: string; password?: string };
      if (body.email !== "user@example.com" || body.password !== "secret") {
        send(res, 401, {
          error: true,
          messages: ["Suas credenciais estão incorretas."],
          results: null,
        });
        return;
      }
      send(res, 200, {
        error: false,
        messages: ["Usuário logado com sucesso."],
        results: { token: `token-from-login-${loginCount}` },
      });
      return;
    }

    const authorized =
      auth === "Bearer static-token" || /^Bearer token-from-login-\d+$/.test(auth);
    if (!authorized) {
      send(res, 401, {
        error: true,
        messages: ["Unauthenticated."],
        results: null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/user") {
      send(res, 200, {
        error: false,
        messages: [],
        results: { id: 42, name: "Ada", email: "user@example.com" },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadros") {
      send(res, 200, {
        error: false,
        results: [{ id: "board-uuid-1", titulo: "Board A" }],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/cards") {
      send(res, 200, {
        error: false,
        results: [{ id: "card-1", titulo: "Corrigir login" }],
        meta: { total: 1, filtros_aplicados: Object.fromEntries(url.searchParams) },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/invalid/cards") {
      send(res, 422, {
        message: "Parâmetros de filtro inválidos",
        errors: { data_prazo_de: ["Formato inválido. Use YYYY-MM-DD."] },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tickets") {
      send(res, 200, { error: false, results: [{ uuid: "t-1", titulo: "Ticket" }] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard/estatisticas") {
      send(res, 200, { error: false, results: { cards: 10 } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard/relatorio-diario-equipe") {
      send(res, 200, { error: false, results: { membros: [] } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/notificacoes") {
      send(res, 200, { error: false, results: [{ id: "n-1", lida: false }] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/notificacoes/contagem") {
      send(res, 200, { error: false, results: { total: 2, nao_lidas: 1 } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/colunas") {
      send(res, 200, {
        error: false,
        results: [
          { id: 6, titulo: "Desenvolvimento" },
          { id: 12, titulo: "Concluído / Publicado" },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/projetos") {
      send(res, 200, {
        error: false,
        results: {
          data: [
            {
              id: 88,
              nome: "Sistema Secretaria",
              cliente: "Paysandu",
              cliente_id: 15,
              status: "Iniciado",
            },
          ],
        },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quadro/board-uuid-1/coluna/12/card") {
      const body = (await readJson(req)) as { titulo?: string; qtd_horas?: unknown };
      send(res, 201, {
        error: false,
        messages: ["Card criado com sucesso."],
        results: {
          id: "new-card-uuid",
          titulo: body.titulo,
          coluna_id: 12,
          qtd_horas_no_create: body.qtd_horas ?? null,
        },
      });
      return;
    }

    if (
      req.method === "PUT" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/new-card-uuid"
    ) {
      const body = (await readJson(req)) as { qtd_horas?: number };
      send(res, 200, {
        error: false,
        messages: ["Card atualizado com sucesso."],
        results: { id: "new-card-uuid", qtd_horas: body.qtd_horas },
      });
      return;
    }

    if (
      req.method === "PATCH" &&
      url.pathname ===
        "/api/quadro/board-uuid-1/coluna/12/card/new-card-uuid/membro/42/toggle"
    ) {
      send(res, 200, { error: false, messages: ["Sucesso!"], results: { id: "new-card-uuid" } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/card/card-1") {
      send(res, 200, {
        error: false,
        results: {
          id: "card-1",
          quadro_id: "board-uuid-1",
          coluna_id: 12,
          titulo: "Corrigir login",
          data_prazo: null,
          checklists: [
            { id: 3, titulo: "QA", itens: [{ id: 7, descricao: "Testar login", concluido: false }] },
          ],
          horas: [{ id: 9, horas: 2, user: "Ada" }],
          anexos: [{ id: "anexo-uuid-1", nome: "print.png" }],
          projeto: { id: 88, nome: "Sistema Secretaria" },
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/card/new-card-uuid") {
      send(res, 200, {
        error: false,
        results: {
          id: "new-card-uuid",
          quadro_id: "board-uuid-1",
          coluna_id: 12,
          titulo: "Registrar horas da missão",
          projeto: { id: 88, nome: "Sistema Secretaria" },
          checklists: [],
          horas: [],
          anexos: [],
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/etiquetas") {
      send(res, 200, {
        error: false,
        results: [{ id: 4, titulo: "Bug", cor: "#e74c3c" }],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/membros") {
      send(res, 200, {
        error: false,
        results: [{ id: 42, name: "Ada" }, { id: 7, name: "Linus" }],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/quadro/board-uuid-1/clientes") {
      send(res, 200, {
        error: false,
        results: [{ id: 15, nome: "Paysandu" }],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/clientes") {
      send(res, 200, {
        error: false,
        results: [{ id: 15, nome: "Paysandu" }],
        meta: { total: 1, page: 1, per_page: 200 },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/repositorios") {
      send(res, 200, {
        error: false,
        results: [
          {
            id: 21,
            full_name: "brediweb/b-ticket-backend",
            name: "b-ticket-backend",
            html_url: "https://github.com/brediweb/b-ticket-backend",
          },
        ],
      });
      return;
    }

    if (
      req.method === "PUT" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1"
    ) {
      const body = (await readJson(req)) as { data_prazo?: string; qtd_horas?: number };
      send(res, 200, {
        error: false,
        messages: ["Card atualizado com sucesso."],
        results: { id: "card-1", ...body },
      });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1/atividade"
    ) {
      const body = (await readJson(req)) as { descricao?: string };
      send(res, 201, {
        error: false,
        results: { id: 55, descricao: body.descricao, comentario: true },
      });
      return;
    }

    if (
      req.method === "PATCH" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1/etiqueta/4/toggle"
    ) {
      send(res, 200, { error: false, messages: ["Sucesso!"], results: { id: "card-1" } });
      return;
    }

    if (
      req.method === "PATCH" &&
      url.pathname === "/api/quadro/board-uuid-1/card/card-1/mover/6"
    ) {
      send(res, 200, {
        error: false,
        messages: ["Card movido com sucesso."],
        results: { id: "card-1", coluna_id: 6 },
      });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1/anexo"
    ) {
      req.resume();
      await new Promise<void>((resolve) => req.on("end", resolve));
      send(res, 201, {
        error: false,
        results: { id: "anexo-uuid-2", nome: "nota.txt" },
      });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1/checklist"
    ) {
      const body = (await readJson(req)) as { titulo?: string };
      send(res, 201, { error: false, results: { id: 3, titulo: body.titulo } });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/quadro/board-uuid-1/coluna/12/card/card-1/checklist/3/item"
    ) {
      const body = (await readJson(req)) as { descricao?: string };
      send(res, 201, { error: false, results: { id: 8, descricao: body.descricao } });
      return;
    }

    if (
      req.method === "PATCH" &&
      url.pathname ===
        "/api/quadro/board-uuid-1/coluna/12/card/card-1/checklist/3/item/7/toggle"
    ) {
      send(res, 200, { error: false, results: { id: 7, concluido: true } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projeto/88/repositorios") {
      const body = (await readJson(req)) as { repositorios?: unknown };
      send(res, 201, { error: false, results: body.repositorios });
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/card_hora/9") {
      send(res, 200, { error: false, messages: ["Hora deletada com sucesso."] });
      return;
    }

    send(res, 404, { message: "Not found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind mock API");
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        calls,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

describe("bticket-mcp smoke", () => {
  let mock: Awaited<ReturnType<typeof startMockApi>>;

  before(async () => {
    mock = await startMockApi();
  });

  after(async () => {
    await mock.close();
  });

  it("extracts Sanctum token from results.token", () => {
    const token = extractToken({
      error: false,
      results: { token: "1|abc", plainTextToken: undefined },
    });
    assert.equal(token, "1|abc");
  });

  it("flattens nested board areas from GET /quadros", () => {
    const uuids = extractBoardUuids({
      error: false,
      results: [
        {
          id: 18,
          nome: "Silvio",
          quadros: [{ id: "board-uuid-1", titulo: "Kanban" }],
        },
      ],
    });
    assert.deepEqual(uuids, ["board-uuid-1"]);
  });

  it("logs in once, caches the token, and hits the real API paths", async () => {
    const client = new BticketClient({
      apiUrl: mock.url,
      email: "user@example.com",
      password: "secret",
    });

    const me = await client.whoami();
    const boards = await client.listBoards();
    const cards = await client.listCards("board-uuid-1", { membro_id: "42", atrasado: true });

    assert.deepEqual(me, {
      error: false,
      messages: [],
      results: { id: 42, name: "Ada", email: "user@example.com" },
    });
    assert.match(JSON.stringify(boards), /board-uuid-1/);
    assert.match(JSON.stringify(cards), /Corrigir login/);
    assert.equal(mock.calls.filter((call) => call === "POST /api/user/login").length, 1);
    assert.ok(mock.calls.includes("GET /api/user"));
    assert.ok(mock.calls.includes("GET /api/quadros"));
    assert.ok(mock.calls.includes("GET /api/quadro/board-uuid-1/cards"));
  });

  it("surfaces Laravel 401 messages", async () => {
    const client = new BticketClient({
      apiUrl: mock.url,
      email: "wrong@example.com",
      password: "nope",
    });

    await assert.rejects(
      () => client.whoami(),
      (error: unknown) => {
        assert.ok(error instanceof BticketApiError);
        assert.equal(error.status, 401);
        assert.match(error.message, /401/);
        assert.match(error.message, /credenciais estão incorretas/);
        return true;
      },
    );
  });

  it("surfaces Laravel 422 validation messages", async () => {
    const client = new BticketClient({
      apiUrl: mock.url,
      token: "static-token",
    });

    await assert.rejects(
      () => client.listCards("invalid", { data_prazo_de: "nope" }),
      (error: unknown) => {
        assert.ok(error instanceof BticketApiError);
        assert.equal(error.status, 422);
        assert.match(error.message, /422/);
        assert.match(error.message, /YYYY-MM-DD/);
        return true;
      },
    );
  });

  it("skips login when BTICKET_TOKEN is provided", async () => {
    const before = mock.calls.length;
    const client = new BticketClient({
      apiUrl: mock.url,
      token: "static-token",
    });
    await client.listTickets();
    const extra = mock.calls.slice(before);
    assert.ok(!extra.includes("POST /api/user/login"));
    assert.ok(extra.includes("GET /api/tickets"));
  });

  it("registers MCP tools and calls the wrapped endpoints", async () => {
    const client = new BticketClient({
      apiUrl: mock.url,
      email: "user@example.com",
      password: "secret",
    });
    const server = createMcpServer(client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "smoke", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const listed = await mcpClient.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "bticket_add_attachment",
      "bticket_add_checklist",
      "bticket_add_comment",
      "bticket_add_hours",
      "bticket_create_card",
      "bticket_dashboard_stats",
      "bticket_delete_attachment",
      "bticket_delete_hours",
      "bticket_get_card",
      "bticket_link_repository",
      "bticket_list_boards",
      "bticket_list_cards",
      "bticket_list_clients",
      "bticket_list_columns",
      "bticket_list_labels",
      "bticket_list_members",
      "bticket_list_my_open_cards",
      "bticket_list_notifications",
      "bticket_list_projects",
      "bticket_list_repositories",
      "bticket_list_tickets",
      "bticket_move_card",
      "bticket_toggle_checklist_item",
      "bticket_toggle_label",
      "bticket_toggle_member",
      "bticket_update_card",
      "bticket_whoami",
    ]);

    const whoami = await mcpClient.callTool({ name: "bticket_whoami", arguments: {} });
    assert.equal(whoami.isError ?? false, false);
    const whoamiText = JSON.stringify(whoami);
    assert.match(whoamiText, /Ada/);

    const openCards = await mcpClient.callTool({
      name: "bticket_list_my_open_cards",
      arguments: { board_uuid: "board-uuid-1" },
    });
    const openText = JSON.stringify(openCards);
    assert.match(openText, /single_board/);
    assert.match(openText, /membro_id/);
    assert.match(openText, /42/);

    const notifications = await mcpClient.callTool({
      name: "bticket_list_notifications",
      arguments: {},
    });
    assert.match(JSON.stringify(notifications), /nao_lidas/);

    const created = await mcpClient.callTool({
      name: "bticket_create_card",
      arguments: {
        board_uuid: "board-uuid-1",
        titulo: "Registrar horas da missão",
        descricao: "Ajustei a importação de atletas e o histórico de condições.",
        projeto: "Secretaria",
        qtd_horas: 2,
      },
    });
    const createdText = JSON.stringify(created);
    assert.equal(created.isError ?? false, false);
    assert.match(createdText, /new-card-uuid/);
    assert.match(createdText, /Sistema Secretaria/);
    assert.match(createdText, /Concluído \/ Publicado/);
    assert.ok(mock.calls.includes("POST /api/quadro/board-uuid-1/coluna/12/card"));
    assert.ok(mock.calls.includes("PUT /api/quadro/board-uuid-1/coluna/12/card/new-card-uuid"));
    assert.ok(
      mock.calls.includes(
        "PATCH /api/quadro/board-uuid-1/coluna/12/card/new-card-uuid/membro/42/toggle",
      ),
    );

    await mcpClient.close();
    await server.close();
  });

  it("updates card fields, hours, comment, label, attachment, checklist and repository", async () => {
    const api = new BticketClient({
      apiUrl: mock.url,
      email: "user@example.com",
      password: "secret",
    });
    const server = createMcpServer(api);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "smoke", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const got = await mcpClient.callTool({
      name: "bticket_get_card",
      arguments: { board_uuid: "board-uuid-1", card_uuid: "card-1" },
    });
    assert.equal(got.isError ?? false, false);
    assert.match(JSON.stringify(got), /Corrigir login/);

    const updated = await mcpClient.callTool({
      name: "bticket_update_card",
      arguments: {
        board_uuid: "board-uuid-1",
        card_uuid: "card-1",
        data_prazo: "2026-09-20",
        cliente: "Paysandu",
      },
    });
    assert.equal(updated.isError ?? false, false);
    assert.match(JSON.stringify(updated), /2026-09-20/);

    const hours = await mcpClient.callTool({
      name: "bticket_add_hours",
      arguments: { board_uuid: "board-uuid-1", card_uuid: "card-1", qtd_horas: 1.5 },
    });
    assert.equal(hours.isError ?? false, false);

    const comment = await mcpClient.callTool({
      name: "bticket_add_comment",
      arguments: {
        board_uuid: "board-uuid-1",
        card_uuid: "card-1",
        descricao: "Ajustei o login e registrei o prazo.",
      },
    });
    assert.equal(comment.isError ?? false, false);
    assert.match(JSON.stringify(comment), /Ajustei o login/);

    const label = await mcpClient.callTool({
      name: "bticket_toggle_label",
      arguments: { board_uuid: "board-uuid-1", card_uuid: "card-1", etiqueta: "Bug" },
    });
    assert.equal(label.isError ?? false, false);

    const moved = await mcpClient.callTool({
      name: "bticket_move_card",
      arguments: { board_uuid: "board-uuid-1", card_uuid: "card-1", coluna: "Desenvolvimento" },
    });
    assert.equal(moved.isError ?? false, false);
    assert.match(JSON.stringify(moved), /Desenvolvimento/);

    const attachment = await mcpClient.callTool({
      name: "bticket_add_attachment",
      arguments: {
        board_uuid: "board-uuid-1",
        card_uuid: "card-1",
        arquivo_nome: "nota.txt",
        arquivo_base64: Buffer.from("hello").toString("base64"),
      },
    });
    assert.equal(attachment.isError ?? false, false);
    assert.match(JSON.stringify(attachment), /anexo-uuid-2/);

    const checklist = await mcpClient.callTool({
      name: "bticket_toggle_checklist_item",
      arguments: {
        board_uuid: "board-uuid-1",
        card_uuid: "card-1",
        checklist: "QA",
        item: "Testar login",
      },
    });
    assert.equal(checklist.isError ?? false, false);

    const repo = await mcpClient.callTool({
      name: "bticket_link_repository",
      arguments: {
        board_uuid: "board-uuid-1",
        card_uuid: "card-1",
        repositorio: "b-ticket-backend",
        papel: "backend",
      },
    });
    assert.equal(repo.isError ?? false, false);
    assert.match(JSON.stringify(repo), /b-ticket-backend/);

    const clients = await mcpClient.callTool({
      name: "bticket_list_clients",
      arguments: { board_uuid: "board-uuid-1" },
    });
    assert.match(JSON.stringify(clients), /Paysandu/);

    await mcpClient.close();
    await server.close();
  });
});
