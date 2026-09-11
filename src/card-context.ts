import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { BticketClient } from "./bticket/client.js";
import {
  BticketApiError,
  asRecord,
  extractArray,
  extractCardLocation,
  extractResults,
  extractUserId,
  firstString,
} from "./bticket/errors.js";
import {
  boardsFromPayload,
  clientsFromPayload,
  columnsFromPayload,
  labelsFromPayload,
  membersFromPayload,
  pickBoard,
  pickByIdOrName,
  pickByName,
  pickColumn,
  projectsFromPayload,
  repositoriesFromPayload,
  toApiId,
  type NamedItem,
} from "./bticket/resolve.js";
import type { AttachmentFile } from "./bticket/types.js";

export type CardTarget = {
  board: NamedItem;
  colunaId: string;
  cardUuid: string;
  card: unknown;
};

export async function resolveBoard(
  client: BticketClient,
  boardUuid?: string,
  board?: string,
): Promise<NamedItem> {
  const payload = await client.listBoards();
  return pickBoard(boardsFromPayload(payload), boardUuid, board);
}

export async function resolveCardTarget(
  client: BticketClient,
  args: {
    card_uuid: string;
    board_uuid?: string;
    board?: string;
    coluna_id?: string;
  },
): Promise<CardTarget> {
  const board = await resolveBoard(client, args.board_uuid, args.board);
  const card = await client.getCard(board.id, args.card_uuid);
  const location = extractCardLocation(card);
  const colunaId = args.coluna_id ?? location?.colunaId;
  if (!colunaId) {
    throw new BticketApiError(
      "Não foi possível obter a coluna do card. Informe coluna_id.",
      400,
      card,
    );
  }
  return {
    board,
    colunaId,
    cardUuid: location?.cardUuid ?? args.card_uuid,
    card,
  };
}

export async function resolveColumn(
  client: BticketClient,
  boardUuid: string,
  colunaId?: string,
  coluna?: string,
  preferConcluded = false,
): Promise<NamedItem> {
  const payload = await client.listColumns(boardUuid);
  return pickColumn(columnsFromPayload(payload), colunaId, coluna, preferConcluded);
}

export type ProjectClientRef = {
  projetoId?: string;
  projetoNome?: string;
  clienteId?: string;
  clienteNome?: string;
};

export async function resolveProjectAndClient(
  client: BticketClient,
  args: {
    projeto_id?: string;
    projeto?: string;
    cliente_id?: string;
    cliente?: string;
    boardUuid?: string;
  },
): Promise<ProjectClientRef> {
  const result: ProjectClientRef = {
    projetoId: args.projeto_id,
    clienteId: args.cliente_id,
  };

  if (args.projeto || args.projeto_id) {
    const projectsPayload = await client.listProjects({
      per_page: 500,
      page: 1,
      cliente_id: args.cliente_id,
    });
    const projects = projectsFromPayload(projectsPayload);
    const chosen = pickByIdOrName(projects, args.projeto_id, args.projeto, "Projeto");
    result.projetoId = chosen.id;
    result.projetoNome = chosen.titulo;
    if (!result.clienteId && chosen.extra?.cliente_id != null) {
      result.clienteId = String(chosen.extra.cliente_id);
    }
    if (!result.clienteNome && typeof chosen.extra?.cliente === "string") {
      result.clienteNome = chosen.extra.cliente;
    }
  }

  if (args.cliente || (args.cliente_id && !result.clienteNome)) {
    const clients = await loadClients(client, args.boardUuid, args.cliente);
    const chosen = pickByIdOrName(clients, args.cliente_id ?? result.clienteId, args.cliente, "Cliente");
    result.clienteId = chosen.id;
    result.clienteNome = chosen.titulo;
  }

  return result;
}

async function loadClients(
  client: BticketClient,
  boardUuid?: string,
  nome?: string,
): Promise<NamedItem[]> {
  if (boardUuid) {
    const boardClients = clientsFromPayload(await client.listBoardClients(boardUuid));
    if (boardClients.length > 0) {
      return boardClients;
    }
  }
  return clientsFromPayload(
    await client.listClients({
      nome,
      per_page: 200,
      page: 1,
    }),
  );
}

export async function resolveLabel(
  client: BticketClient,
  boardUuid: string,
  etiquetaId?: string,
  etiqueta?: string,
  options: { createIfMissing?: boolean; cor?: string } = {},
): Promise<NamedItem> {
  const labels = labelsFromPayload(await client.listBoardLabels(boardUuid));
  if (etiquetaId || etiqueta) {
    try {
      return pickByIdOrName(labels, etiquetaId, etiqueta, "Etiqueta");
    } catch (error) {
          if (!options.createIfMissing || !etiqueta || !(error instanceof BticketApiError)) {
            throw error;
          }
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  if (options.createIfMissing && etiqueta) {
    const created = await client.createBoardLabel(boardUuid, {
      titulo: etiqueta,
      cor: options.cor ?? "#3498db",
    });
    const record = asRecord(extractResults(created));
    const id = record?.id;
    if (id === undefined || id === null) {
      throw new BticketApiError("Etiqueta criada, mas o id não veio na resposta.", 500, created);
    }
    return {
      id: String(id),
      titulo: firstString(record?.titulo, etiqueta) ?? etiqueta,
    };
  }

  throw new BticketApiError("Informe etiqueta ou etiqueta_id.", 400, labels);
}

export async function resolveMember(
  client: BticketClient,
  boardUuid: string,
  membroId?: string,
  membro?: string,
  assignSelf?: boolean,
): Promise<NamedItem> {
  if (assignSelf) {
    const me = await client.whoami();
    const userId = extractUserId(me);
    if (!userId) {
      throw new BticketApiError(
        "Não foi possível obter o id do usuário autenticado (GET /api/user).",
        500,
        me,
      );
    }
    const meRecord = asRecord(extractResults(me));
    return {
      id: userId,
      titulo: firstString(meRecord?.name, meRecord?.nome, "eu") ?? "eu",
    };
  }

  const members = membersFromPayload(await client.listBoardMembers(boardUuid));
  return pickByIdOrName(members, membroId, membro, "Membro");
}

export async function resolveRepository(
  client: BticketClient,
  repositorioId?: string,
  repositorio?: string,
  projetoId?: string,
): Promise<NamedItem> {
  if (repositorioId) {
    const payload = await client.getRepository(repositorioId);
    const record = asRecord(extractResults(payload));
    const id = record?.id;
    const titulo = firstString(record?.full_name, record?.name);
    if (id === undefined || id === null) {
      throw new BticketApiError(`Repositório id ${repositorioId} não encontrado.`, 404, payload);
    }
    return { id: String(id), titulo: titulo ?? String(id), extra: record };
  }

  if (!repositorio) {
    throw new BticketApiError("Informe repositorio ou repositorio_id.", 400, null);
  }

  const payload = await client.listRepositories({
    q: repositorio,
    projeto_id: projetoId,
    per_page: 100,
  });
  const repos = repositoriesFromPayload(payload);
  if (repos.length === 0) {
    const fallback = repositoriesFromPayload(
      await client.listRepositories({ q: repositorio, per_page: 100 }),
    );
    return pickByName(fallback, repositorio, "Repositório");
  }
  return pickByName(repos, repositorio, "Repositório");
}

export function cardFieldBody(fields: {
  titulo?: string;
  descricao?: string;
  data_inicio?: string;
  data_entrega?: string;
  data_prazo?: string;
  arquivado?: boolean;
  cliente_id?: string;
  projeto_id?: string;
  fase_id?: string;
  qtd_horas?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.titulo !== undefined) body.titulo = fields.titulo;
  if (fields.descricao !== undefined) body.descricao = fields.descricao;
  if (fields.data_inicio !== undefined) body.data_inicio = fields.data_inicio;
  if (fields.data_entrega !== undefined) body.data_entrega = fields.data_entrega;
  if (fields.data_prazo !== undefined) body.data_prazo = fields.data_prazo;
  if (fields.arquivado !== undefined) body.arquivado = fields.arquivado;
  if (fields.cliente_id) body.cliente_id = toApiId(fields.cliente_id);
  if (fields.projeto_id) body.projeto_id = toApiId(fields.projeto_id);
  if (fields.fase_id) body.fase_id = toApiId(fields.fase_id);
  if (fields.qtd_horas !== undefined) body.qtd_horas = fields.qtd_horas;
  return body;
}

export async function readAttachmentFile(args: {
  arquivo_caminho?: string;
  arquivo_base64?: string;
  arquivo_nome?: string;
}): Promise<AttachmentFile> {
  if (args.arquivo_caminho) {
    const bytes = new Uint8Array(await readFile(args.arquivo_caminho));
    return {
      filename: args.arquivo_nome?.trim() || basename(args.arquivo_caminho),
      bytes,
    };
  }

  if (args.arquivo_base64) {
    const filename = args.arquivo_nome?.trim();
    if (!filename) {
      throw new BticketApiError(
        "Informe arquivo_nome junto com arquivo_base64.",
        400,
        null,
      );
    }
    return {
      filename,
      bytes: Uint8Array.from(Buffer.from(args.arquivo_base64, "base64")),
    };
  }

  throw new BticketApiError(
    "Informe arquivo_caminho (path local) ou arquivo_base64 + arquivo_nome.",
    400,
    null,
  );
}

export function extractCreatedId(payload: unknown, label: string): string {
  const record = asRecord(extractResults(payload));
  const id = record?.id ?? record?.uuid;
  if (id === undefined || id === null) {
    throw new BticketApiError(`${label} criado, mas o id não veio na resposta.`, 500, payload);
  }
  return String(id);
}

export function findChecklistItem(
  cardPayload: unknown,
  checklistId?: string,
  checklist?: string,
  itemId?: string,
  item?: string,
): { checklistId: string; itemId: string; checklistTitulo?: string; itemDescricao?: string } {
  const card = asRecord(extractResults(cardPayload));
  const checklists = Array.isArray(card?.checklists) ? card.checklists : extractArray(cardPayload);
  const namedChecklists: Array<{ id: string; titulo: string; itens: unknown[] }> = [];

  for (const entry of checklists) {
    const record = asRecord(entry);
    if (!record || record.id == null) {
      continue;
    }
    namedChecklists.push({
      id: String(record.id),
      titulo: firstString(record.titulo, record.nome) ?? "",
      itens: Array.isArray(record.itens) ? record.itens : [],
    });
  }

  const checklistItems = namedChecklists.map((entry) => ({
    id: entry.id,
    titulo: entry.titulo,
  }));
  const chosenChecklist = pickByIdOrName(checklistItems, checklistId, checklist, "Checklist");
  const full = namedChecklists.find((entry) => entry.id === chosenChecklist.id);
  const items: NamedItem[] = (full?.itens ?? []).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record || record.id == null) {
      return [];
    }
    return [
      {
        id: String(record.id),
        titulo: firstString(record.descricao, record.titulo) ?? "",
      },
    ];
  });

  const chosenItem = pickByIdOrName(items, itemId, item, "Item de checklist");
  return {
    checklistId: chosenChecklist.id,
    itemId: chosenItem.id,
    checklistTitulo: chosenChecklist.titulo,
    itemDescricao: chosenItem.titulo,
  };
}
