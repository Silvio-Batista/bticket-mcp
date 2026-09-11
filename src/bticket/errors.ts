export class BticketApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "BticketApiError";
    this.status = status;
    this.body = body;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function flattenMessages(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenMessages(item));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return Object.values(record).flatMap((item) => flattenMessages(item));
}

export function formatApiError(status: number, body: unknown): string {
  const record = asRecord(body);
  const parts: string[] = [`B-Ticket API HTTP ${status}`];

  if (record) {
    const messages = [
      ...flattenMessages(record.messages),
      ...flattenMessages(record.message),
      ...flattenMessages(record.errors),
    ];
    if (messages.length > 0) {
      parts.push(messages.join(" | "));
    } else {
      try {
        parts.push(JSON.stringify(body));
      } catch {
        parts.push(String(body));
      }
    }
  } else if (typeof body === "string" && body.trim()) {
    parts.push(body.trim());
  }

  return parts.join(": ");
}

export function extractToken(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const candidates: unknown[] = [
    record.token,
    record.plainTextToken,
    record.access_token,
  ];

  const results = asRecord(record.results);
  if (results) {
    candidates.push(results.token, results.plainTextToken, results.access_token);
    const nested = asRecord(results.token);
    if (nested) {
      candidates.push(nested.plainTextToken, nested.token);
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

export function extractResults(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }
  if ("results" in record) {
    return record.results;
  }
  return payload;
}

export function extractUserId(payload: unknown): string | undefined {
  const results = extractResults(payload);
  const record = asRecord(results);
  if (!record) {
    return undefined;
  }
  if (typeof record.id === "number" || typeof record.id === "string") {
    return String(record.id);
  }
  return undefined;
}

export function extractArray(payload: unknown): unknown[] {
  const results = extractResults(payload);
  if (Array.isArray(results)) {
    return results;
  }
  const record = asRecord(results);
  if (Array.isArray(record?.data)) {
    return record.data;
  }
  if (Array.isArray(record?.results)) {
    return record.results;
  }
  return [];
}

export type NamedBoard = {
  uuid: string;
  titulo: string;
};

export function extractBoards(payload: unknown): NamedBoard[] {
  const results = extractResults(payload);
  const roots = Array.isArray(results) ? results : extractArray(payload);
  const boards: NamedBoard[] = [];
  const seen = new Set<string>();

  const visit = (item: unknown): void => {
    const record = asRecord(item);
    if (!record) {
      return;
    }

    const uuidCandidate = record.uuid ?? record.id;
    const tituloCandidate = record.titulo ?? record.nome;
    if (typeof uuidCandidate === "string" && uuidCandidate.trim()) {
      const uuid = uuidCandidate.trim();
      if (!seen.has(uuid)) {
        seen.add(uuid);
        boards.push({
          uuid,
          titulo: typeof tituloCandidate === "string" ? tituloCandidate : "",
        });
      }
    }

    if (Array.isArray(record.quadros)) {
      for (const nested of record.quadros) {
        visit(nested);
      }
    }
  };

  for (const item of roots) {
    visit(item);
  }

  return boards;
}

export function extractBoardUuids(payload: unknown): string[] {
  return extractBoards(payload).map((board) => board.uuid);
}

export function extractCardUuid(payload: unknown): string | undefined {
  const results = extractResults(payload);
  const record = asRecord(results);
  if (!record) {
    return undefined;
  }
  const id = record.uuid ?? record.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export type CardLocation = {
  cardUuid: string;
  boardUuid?: string;
  colunaId?: string;
};

export function extractCardLocation(payload: unknown): CardLocation | undefined {
  const results = extractResults(payload);
  const record = asRecord(results);
  if (!record) {
    return undefined;
  }

  const id = record.uuid ?? record.id;
  const cardUuid = typeof id === "string" && id.trim() ? id.trim() : undefined;
  if (!cardUuid) {
    return undefined;
  }

  const colunaRaw = record.coluna_id;
  const colunaId =
    typeof colunaRaw === "number" || typeof colunaRaw === "string"
      ? String(colunaRaw)
      : undefined;

  const boardRaw = record.quadro_id;
  const boardUuid =
    typeof boardRaw === "string" && boardRaw.trim() ? boardRaw.trim() : undefined;

  return { cardUuid, boardUuid, colunaId };
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
