import {
  BticketApiError,
  extractToken,
  formatApiError,
} from "./errors.js";
import type { CardFilters } from "./types.js";

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
      ? `/quadro/${encodeURIComponent(boardUuid)}/cards/concluidos`
      : `/quadro/${encodeURIComponent(boardUuid)}/cards`;
    return this.request("GET", path, { query: filters });
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

  private async request(
    method: "GET" | "POST",
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

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
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
