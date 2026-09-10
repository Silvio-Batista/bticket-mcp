import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BticketClient } from "./bticket/client.js";
import {
  BticketApiError,
  extractBoardUuids,
  extractCardUuid,
  extractUserId,
} from "./bticket/errors.js";
import {
  boardsFromPayload,
  pickBoard,
  pickByName,
  pickColumn,
  columnsFromPayload,
  projectsFromPayload,
} from "./bticket/resolve.js";
import type { CardFilters } from "./bticket/types.js";

export const SERVER_NAME = "bticket-mcp";
export const SERVER_VERSION = "1.1.0";

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true" || value === "1";
  });

const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe("ID único ou lista (OR dentro do mesmo filtro)");

const cardFilterShape = {
  busca: z.string().optional().describe("Busca textual em título, descrição, cliente e projeto"),
  membro_id: idList.describe("Filtrar cards que tenham um destes membros"),
  etiqueta_id: idList.describe("Filtrar cards que tenham uma destas etiquetas"),
  cliente_id: z.string().optional().describe("UUID do cliente"),
  projeto_id: z.string().optional().describe("UUID do projeto"),
  coluna_id: idList.describe("Filtrar por coluna(s)"),
  data_prazo_de: z.string().optional().describe("Prazo >= YYYY-MM-DD"),
  data_prazo_ate: z.string().optional().describe("Prazo <= YYYY-MM-DD"),
  sem_data: booleanish.describe("true = apenas cards sem data_prazo"),
  atrasado: booleanish.describe("true = prazo anterior a hoje"),
  checklist_concluido: booleanish.describe("true = todos os itens de checklist concluídos"),
  incluir_arquivados: booleanish.describe("true = incluir cards arquivados"),
  page: z.number().int().min(1).optional().describe("Página (default 1)"),
  per_page: z.number().int().min(1).max(200).optional().describe("Itens por página"),
};

function toFilters(args: {
  busca?: string;
  membro_id?: string | string[];
  etiqueta_id?: string | string[];
  cliente_id?: string;
  projeto_id?: string;
  coluna_id?: string | string[];
  data_prazo_de?: string;
  data_prazo_ate?: string;
  sem_data?: boolean;
  atrasado?: boolean;
  checklist_concluido?: boolean;
  incluir_arquivados?: boolean;
  page?: number;
  per_page?: number;
}): CardFilters {
  return {
    busca: args.busca,
    membro_id: args.membro_id,
    etiqueta_id: args.etiqueta_id,
    cliente_id: args.cliente_id,
    projeto_id: args.projeto_id,
    coluna_id: args.coluna_id,
    data_prazo_de: args.data_prazo_de,
    data_prazo_ate: args.data_prazo_ate,
    sem_data: args.sem_data,
    atrasado: args.atrasado,
    checklist_concluido: args.checklist_concluido,
    incluir_arquivados: args.incluir_arquivados,
    page: args.page,
    per_page: args.per_page,
  };
}

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  if (error instanceof BticketApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: error.message,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const writeOnce = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export function createMcpServer(client: BticketClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "bticket_whoami",
    {
      title: "Usuário atual",
      description:
        "Retorna o usuário autenticado na API B-Ticket (GET /api/user), incluindo id, nome, e-mail, papéis e flags de notificações.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => {
      try {
        return jsonResult(await client.whoami());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_boards",
    {
      title: "Listar quadros",
      description:
        "Lista os quadros (boards) acessíveis ao usuário autenticado (GET /api/quadros). Cada quadro usa `id` como UUID.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => {
      try {
        return jsonResult(await client.listBoards());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_cards",
    {
      title: "Listar cards de um quadro",
      description:
        "Lista cards de um quadro B-Ticket. Por padrão GET /api/quadro/{uuid}/cards (colunas ativas). Use concluidos=true para GET /api/quadro/{uuid}/cards/concluidos. Filtros combinam com AND; arrays (membro_id, etiqueta_id, coluna_id) combinam com OR.",
      inputSchema: z.object({
        board_uuid: z.string().min(1).describe("UUID do quadro"),
        concluidos: booleanish.describe("true = cards da coluna de concluídos"),
        ...cardFilterShape,
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const { board_uuid, concluidos, ...filters } = args;
        return jsonResult(
          await client.listCards(board_uuid, toFilters(filters), Boolean(concluidos)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_my_open_cards",
    {
      title: "Meus cards abertos",
      description:
        "Atalho para cards abertos do usuário autenticado. Preferência: passe board_uuid — o servidor resolve o membro_id via GET /api/user e chama GET /api/quadro/{uuid}/cards?membro_id={id}. Sem board_uuid, lista GET /api/quadros e agrega cards de cada quadro (pesado; limitado a 8 quadros). Não use agregação se não precisar.",
      inputSchema: z.object({
        board_uuid: z
          .string()
          .optional()
          .describe("UUID do quadro. Recomendado para evitar agregação em vários boards."),
        busca: z.string().optional().describe("Busca textual extra"),
        atrasado: booleanish.describe("true = apenas cards atrasados"),
        per_page: z.number().int().min(1).max(200).optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const me = await client.whoami();
        const membroId = extractUserId(me);
        if (!membroId) {
          return errorResult(
            new Error("Não foi possível obter o id do usuário autenticado (GET /api/user)."),
          );
        }

        const filters: CardFilters = {
          membro_id: membroId,
          busca: args.busca,
          atrasado: args.atrasado,
          per_page: args.per_page ?? 100,
        };

        if (args.board_uuid) {
          const cards = await client.listCards(args.board_uuid, filters);
          return jsonResult({
            approach: "single_board",
            membro_id: membroId,
            board_uuid: args.board_uuid,
            cards,
          });
        }

        const boardsPayload = await client.listBoards();
        const boardUuids = extractBoardUuids(boardsPayload);
        const maxBoards = 8;
        const selected = boardUuids.slice(0, maxBoards);
        const boards = [];
        for (const uuid of selected) {
          const cards = await client.listCards(uuid, filters);
          boards.push({ board_uuid: uuid, cards });
        }

        return jsonResult({
          approach: "aggregate_boards",
          warning:
            "Agregação percorre cada quadro. Prefira board_uuid. Limitado a 8 quadros nesta v1.",
          membro_id: membroId,
          boards_total: boardUuids.length,
          boards_queried: selected.length,
          boards_skipped: Math.max(0, boardUuids.length - selected.length),
          boards,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_tickets",
    {
      title: "Listar tickets",
      description:
        "Lista tickets visíveis ao usuário autenticado (GET /api/tickets). Inclui tickets próprios e de quadros compartilhados, conforme a API.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => {
      try {
        return jsonResult(await client.listTickets());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_dashboard_stats",
    {
      title: "Estatísticas do dashboard",
      description:
        "Lê estatísticas e o relatório diário da equipe: GET /api/dashboard/estatisticas e GET /api/dashboard/relatorio-diario-equipe.",
      inputSchema: z.object({
        include_team_daily_report: booleanish.describe(
          "true (default) inclui relatorio-diario-equipe além de estatisticas",
        ),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const includeReport = args.include_team_daily_report !== false;
        const estatisticas = await client.dashboardStats();
        if (!includeReport) {
          return jsonResult({ estatisticas });
        }
        const relatorio_diario_equipe = await client.dashboardTeamDailyReport();
        return jsonResult({ estatisticas, relatorio_diario_equipe });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_notifications",
    {
      title: "Listar notificações",
      description:
        "Lista as últimas notificações (GET /api/notificacoes) e inclui a contagem de não lidas (GET /api/notificacoes/contagem) quando include_unread_count não for false.",
      inputSchema: z.object({
        apenas_nao_lidas: booleanish.describe("true = somente não lidas"),
        include_unread_count: booleanish.describe(
          "true (default) inclui GET /notificacoes/contagem",
        ),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const includeCount = args.include_unread_count !== false;
        const notifications = await client.listNotifications(args.apenas_nao_lidas);
        if (!includeCount) {
          return jsonResult({ notifications });
        }
        const unread_count = await client.notificationCount();
        return jsonResult({ unread_count, notifications });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_projects",
    {
      title: "Listar projetos",
      description:
        "Lista projetos (GET /api/projetos). Use para resolver o nome do projeto antes de criar um card. Filtro opcional `busca` é aplicado localmente no nome/cliente.",
      inputSchema: z.object({
        busca: z.string().optional().describe("Filtro textual no nome do projeto ou cliente"),
        cliente_id: z.string().optional().describe("Filtrar pelo id numérico do cliente"),
        per_page: z.number().int().min(1).max(500).optional(),
        page: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const payload = await client.listProjects({
          page: args.page,
          per_page: args.per_page,
          cliente_id: args.cliente_id,
        });
        const projects = projectsFromPayload(payload);
        const busca = args.busca?.trim();
        const filtered = busca
          ? projects.filter((item) => {
              const haystack = `${item.titulo} ${String(item.extra?.cliente ?? "")}`;
              return haystack.toLowerCase().includes(busca.toLowerCase());
            })
          : projects;
        return jsonResult({ total: filtered.length, projetos: filtered });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_columns",
    {
      title: "Listar colunas do quadro",
      description:
        "Lista as colunas de um quadro (GET /api/quadro/{uuid}/colunas), ex.: Desenvolvimento, Aguardando QA, Concluído / Publicado.",
      inputSchema: z.object({
        board_uuid: z.string().min(1).describe("UUID do quadro"),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        return jsonResult(await client.listColumns(args.board_uuid));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_create_card",
    {
      title: "Criar card e registrar horas",
      description:
        "Cria um card no B-Ticket para registrar o que foi feito e as horas trabalhadas. Aceita projeto/quadro/coluna por nome (não precisa do id). Fluxo: POST /coluna/{id}/card, opcionalmente PUT com qtd_horas e PATCH para se atribuir ao card. Descrição em texto puro, sem HTML. Se informar qtd_horas e não passar coluna, usa a coluna de Concluído.",
      inputSchema: z.object({
        titulo: z.string().min(1).describe("Título do card"),
        descricao: z
          .string()
          .optional()
          .describe("O que foi pedido e o que foi feito, em texto puro (sem HTML)"),
        qtd_horas: z
          .coerce
          .number()
          .positive()
          .optional()
          .describe("Horas trabalhadas. Lançadas depois da criação via PUT qtd_horas"),
        board_uuid: z.string().optional().describe("UUID do quadro. Preferível se já conhecido"),
        board: z.string().optional().describe("Nome do quadro, se não passar board_uuid"),
        projeto_id: z.string().optional().describe("Id numérico do projeto"),
        projeto: z.string().optional().describe("Nome do projeto, ex.: Sistema Secretaria"),
        cliente_id: z.string().optional().describe("Id numérico do cliente. Se omitido, herda do projeto"),
        coluna_id: z.string().optional().describe("Id numérico da coluna"),
        coluna: z
          .string()
          .optional()
          .describe("Nome da coluna. Default: Concluído se houver horas, senão Desenvolvimento"),
        data_prazo: z.string().optional().describe("YYYY-MM-DD"),
        atribuir_a_mim: booleanish.describe("true (default) atribui o usuário autenticado ao card"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const boardsPayload = await client.listBoards();
        const board = pickBoard(boardsFromPayload(boardsPayload), args.board_uuid, args.board);

        const columnsPayload = await client.listColumns(board.id);
        const column = pickColumn(
          columnsFromPayload(columnsPayload),
          args.coluna_id,
          args.coluna,
          Boolean(args.qtd_horas),
        );

        let projetoId = args.projeto_id;
        let clienteId = args.cliente_id;
        let projetoNome: string | undefined;

        if (args.projeto || args.projeto_id) {
          const projectsPayload = await client.listProjects({ per_page: 500, page: 1 });
          const projects = projectsFromPayload(projectsPayload);

          const chosen = args.projeto_id
            ? projects.find((item) => item.id === String(args.projeto_id))
            : pickByName(projects, args.projeto ?? "", "Projeto");

          if (args.projeto_id && !chosen) {
            throw new BticketApiError(
              `Projeto id ${args.projeto_id} não encontrado. Use bticket_list_projects para buscar pelo nome.`,
              404,
              projects.slice(0, 20),
            );
          }

          if (chosen) {
            projetoId = chosen.id;
            projetoNome = chosen.titulo;
            if (!clienteId && chosen.extra?.cliente_id != null) {
              clienteId = String(chosen.extra.cliente_id);
            }
          }
        }

        const createBody: Record<string, unknown> = {
          titulo: args.titulo,
        };
        if (args.descricao !== undefined) {
          createBody.descricao = args.descricao;
        }
        if (projetoId) {
          createBody.projeto_id = Number(projetoId) || projetoId;
        }
        if (clienteId) {
          createBody.cliente_id = Number(clienteId) || clienteId;
        }
        if (args.data_prazo) {
          createBody.data_prazo = args.data_prazo;
        }

        const created = await client.createCard(board.id, column.id, createBody);
        const cardUuid = extractCardUuid(created);
        if (!cardUuid) {
          throw new BticketApiError(
            "Card criado, mas o UUID não veio na resposta.",
            500,
            created,
          );
        }

        const warnings: string[] = [];
        let horas: unknown;
        let membro: unknown;

        if (args.qtd_horas) {
          horas = await client.updateCard(board.id, column.id, cardUuid, {
            qtd_horas: args.qtd_horas,
          });
        }

        if (args.atribuir_a_mim !== false) {
          const me = await client.whoami();
          const userId = extractUserId(me);
          if (!userId) {
            warnings.push("Não foi possível obter o id do usuário para se atribuir ao card.");
          } else {
            membro = await client.toggleCardMember(board.id, column.id, cardUuid, userId);
          }
        }

        return jsonResult({
          ok: true,
          board: { uuid: board.id, titulo: board.titulo },
          coluna: { id: column.id, titulo: column.titulo },
          projeto: projetoId ? { id: projetoId, nome: projetoNome } : null,
          card_uuid: cardUuid,
          qtd_horas: args.qtd_horas ?? null,
          warnings,
          created,
          horas: horas ?? null,
          membro: membro ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
