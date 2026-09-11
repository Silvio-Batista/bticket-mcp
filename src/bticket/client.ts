import {
  BticketApiError,
  extractToken,
  formatApiError,
} from "./errors.js";
import type { AttachmentFile, CardFilters, RepositoryFilters } from "./types.js";

export type BticketClientOptions = {
  apiUrl: string;
  email?: string;
  password?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

function appendQuery(
  params: URLSearchParams,
  key: string,
  value: string | string[] | number | boolean | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && String(item).length > 0) {
        params.append(key, String(item));
      }
    }
    return;
  }
  if (typeof value === "boolean") {
    params.set(key, value ? "true" : "false");
    return;
  }
  params.set(key, String(value));
}

function enc(value: string | number): string {
  return encodeURIComponent(String(value));
}

export class BticketClient {
  private readonly apiRoot: string;
  private readonly email?: string;
  private readonly password?: string;
  private readonly staticToken?: string;
  private readonly fetchImpl: typeof fetch;
  private cachedToken?: string;
  private loginInFlight?: Promise<string>;

  constructor(options: BticketClientOptions) {
    this.apiRoot = `${options.apiUrl.replace(/\/+$/, "")}/api`;
    this.email = options.email;
    this.password = options.password;
    this.staticToken = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (this.staticToken) {
      this.cachedToken = this.staticToken;
    }
  }

  async whoami(): Promise<unknown> {
    return this.request("GET", "/user");
  }

  async listBoards(): Promise<unknown> {
    return this.request("GET", "/quadros");
  }

  async listCards(
    boardUuid: string,
    filters: CardFilters = {},
    concluded = false,
  ): Promise<unknown> {
    const path = concluded
      ? `/quadro/${enc(boardUuid)}/cards/concluidos`
      : `/quadro/${enc(boardUuid)}/cards`;
    return this.request("GET", path, { query: filters });
  }

  async getCard(boardUuid: string, cardUuid: string): Promise<unknown> {
    return this.request("GET", `/quadro/${enc(boardUuid)}/card/${enc(cardUuid)}`);
  }

  async listTickets(): Promise<unknown> {
    return this.request("GET", "/tickets");
  }

  async dashboardStats(): Promise<unknown> {
    return this.request("GET", "/dashboard/estatisticas");
  }

  async dashboardTeamDailyReport(): Promise<unknown> {
    return this.request("GET", "/dashboard/relatorio-diario-equipe");
  }

  async listNotifications(apenasNaoLidas?: boolean): Promise<unknown> {
    return this.request("GET", "/notificacoes", {
      query: apenasNaoLidas ? { apenas_nao_lidas: 1 } : undefined,
    });
  }

  async notificationCount(): Promise<unknown> {
    return this.request("GET", "/notificacoes/contagem");
  }

  async listColumns(boardUuid: string): Promise<unknown> {
    return this.request("GET", `/quadro/${enc(boardUuid)}/colunas`);
  }

  async listBoardMembers(boardUuid: string): Promise<unknown> {
    return this.request("GET", `/quadro/${enc(boardUuid)}/membros`);
  }

  async listBoardClients(boardUuid: string): Promise<unknown> {
    return this.request("GET", `/quadro/${enc(boardUuid)}/clientes`);
  }

  async listBoardLabels(boardUuid: string): Promise<unknown> {
    return this.request("GET", `/quadro/${enc(boardUuid)}/etiquetas`);
  }

  async createBoardLabel(
    boardUuid: string,
    body: { titulo: string; cor: string },
  ): Promise<unknown> {
    return this.request("POST", `/quadro/${enc(boardUuid)}/etiqueta`, { body });
  }

  async listClients(query: { nome?: string; page?: number; per_page?: number } = {}): Promise<unknown> {
    return this.request("GET", "/clientes", {
      query: {
        nome: query.nome,
        page: query.page ?? 1,
        per_page: query.per_page ?? 200,
      },
    });
  }

  async listProjects(query: { page?: number; per_page?: number; cliente_id?: string } = {}): Promise<unknown> {
    return this.request("GET", "/projetos", {
      query: {
        page: query.page ?? 1,
        per_page: query.per_page ?? 200,
        por_pagina: query.per_page ?? 200,
        cliente_id: query.cliente_id,
      },
    });
  }

  async listRepositories(filters: RepositoryFilters = {}): Promise<unknown> {
    return this.request("GET", "/repositorios", {
      query: {
        q: filters.q,
        cliente_id: filters.cliente_id,
        projeto_id: filters.projeto_id,
        language: filters.language,
        topic: filters.topic,
        papel: filters.papel,
        vinculo: filters.vinculo,
        arquivado: filters.arquivado,
        ordenar: filters.ordenar,
        page: filters.page ?? 1,
        pagina: filters.page ?? 1,
        per_page: filters.per_page ?? 50,
        por_pagina: filters.per_page ?? 50,
      },
    });
  }

  async getRepository(repositorioId: string | number): Promise<unknown> {
    return this.request("GET", `/repositorios/${enc(repositorioId)}`);
  }

  async listProjectRepositories(projetoId: string | number): Promise<unknown> {
    return this.request("GET", `/projeto/${enc(projetoId)}/repositorios`);
  }

  async linkProjectRepositories(
    projetoId: string | number,
    repositorios: Array<{ repositorio_id: number; papel: string; observacoes?: string }>,
  ): Promise<unknown> {
    return this.request("POST", `/projeto/${enc(projetoId)}/repositorios`, {
      body: { repositorios },
    });
  }

  async createCard(
    boardUuid: string,
    colunaId: string | number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("POST", this.columnPath(boardUuid, colunaId, "/card"), { body });
  }

  async updateCard(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("PUT", this.cardPath(boardUuid, colunaId, cardUuid), { body });
  }

  async moveCard(
    boardUuid: string,
    cardUuid: string,
    colunaId: string | number,
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      `/quadro/${enc(boardUuid)}/card/${enc(cardUuid)}/mover/${enc(colunaId)}`,
    );
  }

  async toggleCardMember(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    userId: string | number,
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      this.cardPath(boardUuid, colunaId, cardUuid, `/membro/${enc(userId)}/toggle`),
    );
  }

  async listCardLabels(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
  ): Promise<unknown> {
    return this.request("GET", this.cardPath(boardUuid, colunaId, cardUuid, "/etiquetas"));
  }

  async toggleCardLabel(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    etiquetaId: string | number,
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      this.cardPath(boardUuid, colunaId, cardUuid, `/etiqueta/${enc(etiquetaId)}/toggle`),
    );
  }

  async listCardComments(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
  ): Promise<unknown> {
    return this.request("GET", this.cardPath(boardUuid, colunaId, cardUuid, "/atividades"));
  }

  async addCardComment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    body: { descricao: string; mencoes?: number[] },
  ): Promise<unknown> {
    return this.request("POST", this.cardPath(boardUuid, colunaId, cardUuid, "/atividade"), {
      body,
    });
  }

  async updateCardComment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    atividadeId: string | number,
    body: { descricao: string },
  ): Promise<unknown> {
    return this.request(
      "PUT",
      this.cardPath(boardUuid, colunaId, cardUuid, `/atividade/${enc(atividadeId)}`),
      { body },
    );
  }

  async deleteCardComment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    atividadeId: string | number,
  ): Promise<unknown> {
    return this.request(
      "DELETE",
      this.cardPath(boardUuid, colunaId, cardUuid, `/atividade/${enc(atividadeId)}`),
    );
  }

  async listCardAttachments(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
  ): Promise<unknown> {
    return this.request("GET", this.cardPath(boardUuid, colunaId, cardUuid, "/anexos"));
  }

  async addCardAttachment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    file: AttachmentFile,
  ): Promise<unknown> {
    const form = new FormData();
    const blob = new Blob([file.bytes], file.contentType ? { type: file.contentType } : undefined);
    form.append("arquivo", blob, file.filename);
    return this.request("POST", this.cardPath(boardUuid, colunaId, cardUuid, "/anexo"), {
      body: form,
    });
  }

  async renameCardAttachment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    anexoUuid: string,
    nome: string,
  ): Promise<unknown> {
    return this.request(
      "PUT",
      this.cardPath(boardUuid, colunaId, cardUuid, `/anexo/${enc(anexoUuid)}`),
      { body: { nome } },
    );
  }

  async deleteCardAttachment(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    anexoUuid: string,
  ): Promise<unknown> {
    return this.request(
      "DELETE",
      this.cardPath(boardUuid, colunaId, cardUuid, `/anexo/${enc(anexoUuid)}`),
    );
  }

  async listCardChecklists(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
  ): Promise<unknown> {
    return this.request("GET", this.cardPath(boardUuid, colunaId, cardUuid, "/checklists"));
  }

  async createCardChecklist(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    titulo: string,
  ): Promise<unknown> {
    return this.request("POST", this.cardPath(boardUuid, colunaId, cardUuid, "/checklist"), {
      body: { titulo },
    });
  }

  async addChecklistItem(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    checklistId: string | number,
    descricao: string,
  ): Promise<unknown> {
    return this.request(
      "POST",
      this.cardPath(
        boardUuid,
        colunaId,
        cardUuid,
        `/checklist/${enc(checklistId)}/item`,
      ),
      { body: { descricao } },
    );
  }

  async toggleChecklistItem(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    checklistId: string | number,
    itemId: string | number,
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      this.cardPath(
        boardUuid,
        colunaId,
        cardUuid,
        `/checklist/${enc(checklistId)}/item/${enc(itemId)}/toggle`,
      ),
    );
  }

  async deleteHours(horaId: string | number): Promise<unknown> {
    return this.request("DELETE", `/card_hora/${enc(horaId)}`);
  }

  private columnPath(boardUuid: string, colunaId: string | number, suffix = ""): string {
    return `/quadro/${enc(boardUuid)}/coluna/${enc(colunaId)}${suffix}`;
  }

  private cardPath(
    boardUuid: string,
    colunaId: string | number,
    cardUuid: string,
    suffix = "",
  ): string {
    return `${this.columnPath(boardUuid, colunaId, `/card/${enc(cardUuid)}`)}${suffix}`;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      query?: Record<string, string | string[] | number | boolean | undefined>;
      body?: unknown;
      skipAuth?: boolean;
      retried?: boolean;
    } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.apiRoot}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        appendQuery(url.searchParams, key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (!options.skipAuth) {
      headers.Authorization = `Bearer ${await this.getToken()}`;
    }

    let serializedBody: string | FormData | undefined;
    if (options.body instanceof FormData) {
      serializedBody = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: serializedBody,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BticketApiError(
        `Falha de rede ao chamar ${method} ${url.pathname}: ${message}`,
        0,
        null,
      );
    }

    const payload = await this.parseBody(response);

    if (response.status === 401 && !options.skipAuth && !options.retried) {
      if (this.canRelogin()) {
        this.cachedToken = undefined;
        await this.login();
        return this.request(method, path, { ...options, retried: true });
      }
    }

    if (!response.ok) {
      throw new BticketApiError(
        formatApiError(response.status, payload),
        response.status,
        payload,
      );
    }

    return payload;
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private canRelogin(): boolean {
    return Boolean(this.email && this.password) && !this.staticToken;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken) {
      return this.cachedToken;
    }
    if (this.staticToken) {
      this.cachedToken = this.staticToken;
      return this.cachedToken;
    }
    return this.login();
  }

  private async login(): Promise<string> {
    if (this.loginInFlight) {
      return this.loginInFlight;
    }

    this.loginInFlight = this.performLogin().finally(() => {
      this.loginInFlight = undefined;
    });

    return this.loginInFlight;
  }

  private async performLogin(): Promise<string> {
    if (!this.email || !this.password) {
      throw new BticketApiError(
        "Sem token em cache. Defina BTICKET_TOKEN ou BTICKET_EMAIL + BTICKET_PASSWORD.",
        401,
        null,
      );
    }

    const payload = await this.request("POST", "/user/login", {
      skipAuth: true,
      body: { email: this.email, password: this.password },
    });

    const token = extractToken(payload);
    if (!token) {
      throw new BticketApiError(
        "Login ok, mas o token não foi encontrado em results.token / plainTextToken.",
        500,
        payload,
      );
    }

    this.cachedToken = token;
    return token;
  }
}
