# bticket-mcp

Servidor MCP fino que expõe a API Laravel Sanctum do [B-Ticket](https://github.com/brediweb/b-ticket-backend) como ferramentas. O Cursor (e o Grok Bot) passam a consultar usuário, quadros, cards, tickets, dashboard e notificações — e também **criar card com horas** — sem inventar rotas.

A maior parte das tools é **somente leitura**. `bticket_create_card` é a tool de escrita: cria o card, lança horas e se atribui ao card.

## O que este servidor faz

| Ferramenta MCP | Endpoint B-Ticket |
| --- | --- |
| `bticket_whoami` | `GET /api/user` |
| `bticket_list_boards` | `GET /api/quadros` |
| `bticket_list_cards` | `GET /api/quadro/{uuid}/cards` ou `/cards/concluidos` |
| `bticket_list_my_open_cards` | `GET /api/user` + cards filtrados por `membro_id` |
| `bticket_list_tickets` | `GET /api/tickets` |
| `bticket_dashboard_stats` | `GET /api/dashboard/estatisticas` e `GET /api/dashboard/relatorio-diario-equipe` |
| `bticket_list_notifications` | `GET /api/notificacoes` e `GET /api/notificacoes/contagem` |
| `bticket_list_projects` | `GET /api/projetos` |
| `bticket_list_columns` | `GET /api/quadro/{uuid}/colunas` |
| `bticket_create_card` | `POST .../coluna/{id}/card` + `PUT` horas + `PATCH` membro |

`bticket_list_my_open_cards` **prefere** `board_uuid`. Sem o UUID, lista os quadros e agrega até 8 boards — isso é mais pesado e deve ser evitado no dia a dia.

## Host de produção

A API B-Ticket em produção é **`https://bticket.brediweb.com.br`** (sem barra no final). As rotas Laravel ficam em `/api`, por exemplo:

```text
POST https://bticket.brediweb.com.br/api/user/login
GET  https://bticket.brediweb.com.br/api/user
```

Use esse valor em `BTICKET_API_URL`. Não coloque e-mail, senha nem token no git — só placeholders em `.env.example`.

## Requisitos

- Node.js 18+
- Acesso HTTPS à API B-Ticket (`https://bticket.brediweb.com.br` em produção)
- Credenciais Sanctum **ou** um token de longa duração

## Setup

```bash
git clone https://github.com/Silvio-Batista/bticket-mcp.git
cd bticket-mcp
cp .env.example .env
npm install
npm run build
```

Edite `.env` (nunca commite este arquivo):

```env
BTICKET_API_URL=https://bticket.brediweb.com.br
BTICKET_EMAIL=voce@empresa.com
BTICKET_PASSWORD=sua-senha
BTICKET_TOKEN=
PORT=3000
```

- `BTICKET_API_URL` é a origem **sem** barra final e **sem** `/api`. As chamadas vão para `{BTICKET_API_URL}/api/...` (produção: `https://bticket.brediweb.com.br/api/user/login`).
- Se `BTICKET_TOKEN` estiver preenchido, o login é ignorado e o token é usado em `Authorization: Bearer …`.
- Sem token, o servidor faz `POST /api/user/login` com `{ email, password }`, lê `results.token` (Sanctum `plainTextToken`) e guarda o valor **em memória** até o processo reiniciar. Em `401` subsequente, tenta um novo login (somente quando o token não veio de `BTICKET_TOKEN`).

## Scripts

| Script | Uso |
| --- | --- |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Transporte **stdio** (Cursor local) |
| `npm run start:http` | Transporte **Streamable HTTP** (`/mcp`) + SSE legado (`/sse`) |
| `npm run dev` | HTTP com reload (`tsx watch`) |
| `npm test` | Smoke test com API Laravel mockada |

## Uso local (stdio) no Cursor

1. Copie `.env` e rode `npm run build`.
2. Em **Cursor Settings → MCP** (ou `~/.cursor/mcp.json` / `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "bticket": {
      "command": "node",
      "args": ["/caminho/absoluto/bticket-mcp/dist/index.js"],
      "env": {
        "BTICKET_API_URL": "https://bticket.brediweb.com.br",
        "BTICKET_EMAIL": "voce@empresa.com",
        "BTICKET_PASSWORD": "sua-senha"
      }
    }
  }
}
```

Equivalente com token estático:

```json
{
  "mcpServers": {
    "bticket": {
      "command": "node",
      "args": ["/caminho/absoluto/bticket-mcp/dist/index.js"],
      "env": {
        "BTICKET_API_URL": "https://bticket.brediweb.com.br",
        "BTICKET_TOKEN": "1|seu-token-sanctum"
      }
    }
  }
}
```

Reinicie o MCP no Cursor. Em **Output → MCP Logs** você deve ver a sessão stdio e as 10 tools.

Não use `console.log` no processo stdio: stdout é o protocolo MCP. Logs vão para stderr.

## Deploy como MCP remoto (HTTPS)

O modo HTTP sobe:

- `GET /health` — liveness
- `POST|GET|DELETE /mcp` — **Streamable HTTP** (transporte atual, use esta URL no Cursor)
- `GET /sse` + `POST /messages?sessionId=` — SSE legado (clientes antigos)

```bash
npm run build
npm run start:http
```

O servidor escuta em `0.0.0.0:$PORT` (default `3000`). Coloque-o atrás de HTTPS (Railway, Render, Fly, Nginx, Cloudflare Tunnel, etc.) com as variáveis de ambiente acima. O processo autentica **na API B-Ticket**, não no cliente MCP: as credenciais ficam só no host.

URL pública esperada:

```text
https://seu-mcp.example.com/mcp
```

Health check:

```bash
curl https://seu-mcp.example.com/health
```

### Conectar no Cursor (Add MCP Server / URL)

1. Publique o serviço com HTTPS.
2. Cursor → **Settings → MCP → Add new MCP server** (ou edite `mcp.json`):

```json
{
  "mcpServers": {
    "bticket": {
      "url": "https://seu-mcp.example.com/mcp"
    }
  }
}
```

3. Se o cliente só falar SSE antigo, use `https://seu-mcp.example.com/sse`.
4. Ative o servidor e confirme as tools `bticket_*`.

O Grok Bot / Cloud Agent usa o mesmo URL HTTPS. Não coloque senha no `mcp.json` remoto: o MCP já autentica na API com o `.env` do host.

## Filtros de cards

`bticket_list_cards` encaminha os query params oficiais:

`busca`, `membro_id`, `etiqueta_id`, `cliente_id`, `projeto_id`, `coluna_id`, `data_prazo_de`, `data_prazo_ate`, `sem_data`, `atrasado`, `checklist_concluido`, `incluir_arquivados`, `page`, `per_page`.

`membro_id` do usuário logado é o campo `id` de `GET /api/user` (inteiro numérico da API, enviado como string).

## Erros da API

Falhas `401` / `422` / `500` voltam como resultado de tool com `isError` e o texto de `messages`, `message` ou `errors` do Laravel. Exemplo: credenciais inválidas → `B-Ticket API HTTP 401: Suas credenciais estão incorretas.`

## Testes

```bash
npm install
npm test
npm run build
```

O smoke sobe um HTTP mock no estilo `apiResponse` do B-Ticket, valida login + cache de token, paths reais, as tools de leitura e a criação de card (horas + membro) via transporte in-memory do SDK.

## Criar card e lançar horas

Use `bticket_create_card` no final de uma missão, por exemplo:

> faça isso na tarefa X, projeto Sistema Secretaria, e depois crie um card para registrar 2 horas e o que foi feito

A tool resolve quadro/projeto/coluna **por nome**. Campos principais:

- `titulo` — obrigatório
- `descricao` — texto puro (sem HTML) com o pedido e o que foi feito
- `qtd_horas` — lança na API via `PUT` `qtd_horas` (não manda hora no POST de criação)
- `projeto` ou `projeto_id`
- `board_uuid` ou `board` (se só existir um quadro, usa ele)
- `coluna` ou `coluna_id` — se houver horas e a coluna não for informada, cai em **Concluído**

`atribuir_a_mim` vem ligado por padrão.

## Segurança

- `.env` está no `.gitignore`. Só `.env.example` com placeholders entra no git.
- Prefira `BTICKET_TOKEN` de escopo limitado em produção.
- Hoste o MCP remoto só em HTTPS e em rede confiável: quem chama o MCP herda o acesso B-Ticket daquele processo.
