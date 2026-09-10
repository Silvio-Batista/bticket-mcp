import { BticketApiError, asRecord, extractArray, extractBoards } from "./errors.js";

export type NamedItem = {
  id: string;
  titulo: string;
  extra?: Record<string, unknown>;
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function pickByName(
  items: NamedItem[],
  query: string,
  label: string,
): NamedItem {
  const needle = normalizeText(query);
  if (!needle) {
    throw new BticketApiError(`${label}: informe um nome para buscar.`, 400, null);
  }

  const scored = items
    .map((item) => {
      const haystack = normalizeText(item.titulo);
      let score = 0;
      if (haystack === needle) score = 3;
      else if (haystack.startsWith(needle)) score = 2;
      else if (haystack.includes(needle)) score = 1;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.titulo.localeCompare(b.item.titulo, "pt-BR"));

  if (scored.length === 0) {
    const sample = items
      .slice(0, 12)
      .map((item) => `${item.titulo} (${item.id})`)
      .join("; ");
    throw new BticketApiError(
      `${label} "${query}" não encontrado.${sample ? ` Opções: ${sample}` : ""}`,
      404,
      items,
    );
  }

  const best = scored[0].score;
  const ties = scored.filter((entry) => entry.score === best);
  if (ties.length > 1 && best < 3) {
    throw new BticketApiError(
      `${label} "${query}" é ambíguo. Seja mais específico: ${ties
        .map((entry) => `${entry.item.titulo} (${entry.item.id})`)
        .join("; ")}`,
      409,
      ties.map((entry) => entry.item),
    );
  }

  return ties[0].item;
}

export function boardsFromPayload(payload: unknown): NamedItem[] {
  return extractBoards(payload).map((board) => ({
    id: board.uuid,
    titulo: board.titulo,
  }));
}

export function columnsFromPayload(payload: unknown): NamedItem[] {
  return extractArray(payload).flatMap((item) => {
    const record = asRecord(item);
    if (!record) {
      return [];
    }
    const id = record.id;
    const titulo = record.titulo ?? record.nome;
    if (id === undefined || id === null) {
      return [];
    }
    return [
      {
        id: String(id),
        titulo: typeof titulo === "string" ? titulo : "",
      },
    ];
  });
}

export function projectsFromPayload(payload: unknown): NamedItem[] {
  return extractArray(payload).flatMap((item) => {
    const record = asRecord(item);
    if (!record) {
      return [];
    }
    const id = record.id ?? record.uuid;
    const titulo = record.nome ?? record.titulo;
    if (id === undefined || id === null) {
      return [];
    }
    return [
      {
        id: String(id),
        titulo: typeof titulo === "string" ? titulo : "",
        extra: {
          cliente_id: record.cliente_id,
          cliente: record.cliente,
          status: record.status,
        },
      },
    ];
  });
}

export function pickColumn(
  columns: NamedItem[],
  colunaId?: string,
  coluna?: string,
  preferConcluded = false,
): NamedItem {
  if (colunaId) {
    const match = columns.find((item) => item.id === String(colunaId));
    if (!match) {
      throw new BticketApiError(
        `Coluna id ${colunaId} não existe neste quadro. Opções: ${columns
          .map((item) => `${item.titulo} (${item.id})`)
          .join("; ")}`,
        404,
        columns,
      );
    }
    return match;
  }

  if (coluna) {
    return pickByName(columns, coluna, "Coluna");
  }

  const preferred = preferConcluded
    ? columns.find((item) => /conclu/i.test(normalizeText(item.titulo)))
    : columns.find((item) => /desenvolvimento/i.test(normalizeText(item.titulo)));

  if (preferred) {
    return preferred;
  }

  if (columns.length === 0) {
    throw new BticketApiError("Este quadro não tem colunas.", 404, columns);
  }

  return columns[0];
}

export function pickBoard(
  boards: NamedItem[],
  boardUuid?: string,
  board?: string,
): NamedItem {
  if (boardUuid) {
    const match = boards.find((item) => item.id === boardUuid);
    if (match) {
      return match;
    }
    return { id: boardUuid, titulo: boardUuid };
  }

  if (board) {
    return pickByName(boards, board, "Quadro");
  }

  if (boards.length === 1) {
    return boards[0];
  }

  throw new BticketApiError(
    `Informe board_uuid ou board (nome). Quadros: ${boards
      .map((item) => `${item.titulo} (${item.id})`)
      .join("; ")}`,
    400,
    boards,
  );
}
