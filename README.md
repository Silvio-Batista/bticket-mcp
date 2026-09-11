# bticket-mcp

Servidor MCP fino que expõe a API Laravel Sanctum do [B-Ticket](https://github.com/brediweb/b-ticket-backend) como ferramentas. O Cursor (e o Grok Bot) passam a consultar o B-Ticket **e operar um card por completo** — horas, comentário, prazo, etiqueta, cliente, projeto, anexo, repositório, checklist e coluna — sem inventar rotas.

As tools de leitura listam contexto. As tools `bticket_*` de escrita cobrem o ciclo de vida do card. Quadro, projeto, cliente, coluna, etiqueta, membro e repositório aceitam **nome** (não só id).

## O que este servidor faz

| Ferramenta MCP | Endpoint B-Ticket |
| --- | --- |
| `bticket_whoami` | `GET /api/user` |
| `bticket_list_boards` | `GET /api/quadros` |
| `bticket_list_cards` | `GET /api/quadro/{uuid}/cards` ou `/cards/concluidos` |
| `bticket_list_my_open_cards` | `GET /api/user` + cards filtrados por `membro_id` |
| `bticket_get_card` | `GET /api/quadro/{uuid}/card/{uuid}` (card completo) |
| `bticket_list_tickets` | `GET /api/tickets` |
| `bticket_dashboard_stats` | `GET /api/dashboard/estatisticas` e `GET /api/dashboard/relatorio-diario-equipe` |
| `bticket_list_notifications` | `GET /api/notificacoes` e `GET /api/notificacoes/contagem` |
| `bticket_list_projects` | `GET /api/projetos` |
| `bticket_list_clients` | `GET /api/clientes` ou `GET /api/quadro/{uuid}/clientes` |
| `bticket_list_columns` | `GET /api/quadro/{uuid}/colunas` |
| `bticket_list_labels` | `GET /api/quadro/{uuid}/etiquetas` |
| `bticket_list_members` | `GET /api/quadro/{uuid}/membros` |
| `bticket_list_repositories` | `GET /api/repositorios` |
| `bticket_create_card` | `POST .../card` + horas, membro, etiquetas e comentário opcionais |
| `bticket_update_card` | `PUT .../card/{uuid}` (título, prazo, cliente, projeto, horas, etc.) |
| `bticket_add_hours` | `PUT` com `qtd_horas` (cria um lançamento em `card_horas`) |
| `bticket_delete_hours` | `DELETE /api/card_hora/{id}` |
| `bticket_add_comment` | `POST/PUT/DELETE .../atividade` |
| `bticket_toggle_label` | `PATCH .../etiqueta/{id}/toggle` (cria a etiqueta no quadro se `criar=true`) |
| `bticket_toggle_member` | `PATCH .../membro/{user}/toggle` |
| `bticket_move_card` | `PATCH /api/quadro/{uuid}/card/{uuid}/mover/{coluna_id}` |
| `bticket_add_attachment` | `POST` multipart `.../anexo` (`arquivo`) |
| `bticket_delete_attachment` | `DELETE .../anexo/{uuid}` |
| `bticket_add_checklist` | `POST .../checklist` e `POST .../item` |
| `bticket_toggle_checklist_item` | `PATCH .../item/{id}/toggle` |
| `bticket_link_repository` | `POST /api/projeto/{id}/repositorios` (vínculo no **projeto** do card) |

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
npm install
npm run build
```

Credenciais **não** vão no git. No Cursor elas entram no `env` do `mcp.json` (veja [Cursor (MCP)](#cursor-mcp)). Para `npm start` / `npm run start:http`, copie `.env.example` → `.env` com os mesmos campos:

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
| `npm run build` | Compila TypeScript para `dist/` (obrigatório antes de usar no Cursor) |
| `npm start` | Transporte **stdio** — o mesmo que o Cursor chama |
| `npm run start:http` | Transporte **Streamable HTTP** (`/mcp`) + SSE legado (`/sse`) |
| `npm run dev` | HTTP com reload (`tsx watch`) |
| `npm test` | Smoke test com API Laravel mockada |

## Cursor (MCP)

O padrão único é **stdio via `dist/index.js`**. Sempre o mesmo `mcpServers.bticket`: `command` + `args` + `cwd` + `env`. Depois de mudar o código, rode `npm run build` e reinicie o MCP.

Em **Cursor Settings → MCP** ou `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bticket": {
      "command": "node",
      "args": ["C:\\laragon\\www\\bticket-mcp\\dist\\index.js"],
      "cwd": "C:\\laragon\\www\\bticket-mcp",
      "env": {
        "BTICKET_API_URL": "https://bticket.brediweb.com.br",
        "BTICKET_EMAIL": "voce@empresa.com",
        "BTICKET_PASSWORD": "sua-senha"
      }
    }
  }
}
```

Ajuste `args` e `cwd` para o caminho absoluto deste repositório. Não use `url` nem SSE neste fluxo.

No mesmo `env`, em vez de e-mail/senha, pode ir só `BTICKET_TOKEN` (`1|seu-token-sanctum`). Não misture os dois modos: ou credenciais de login, ou token.

Reinicie o MCP. Em **Output → MCP Logs** deve aparecer `bticket-mcp 1.2.0 stdio` e as tools `bticket_*`.

Não use `console.log` no processo stdio: stdout é o protocolo MCP. Logs vão para stderr.

## Deploy como MCP remoto (HTTPS)

Mesmo servidor, outro transporte. As credenciais ficam no `.env` do host (não no `mcp.json`). Suba com:

```bash
npm run build
npm run start:http
```

- `GET /health` — liveness
- `POST|GET|DELETE /mcp` — Streamable HTTP
- `GET /sse` + `POST /messages?sessionId=` — SSE legado

O processo escuta em `0.0.0.0:$PORT` (default `3000`), atrás de HTTPS. O bloco no Cursor continua `mcpServers.bticket`, só troca `command`/`args`/`cwd`/`env` por `url`:

```json
{
  "mcpServers": {
    "bticket": {
      "url": "https://seu-mcp.example.com/mcp"
    }
  }
}
```

Health check: `curl https://seu-mcp.example.com/health`. Grok Bot / Cloud Agent usa a mesma URL.

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

O smoke sobe um HTTP mock no estilo `apiResponse` do B-Ticket, valida login + cache de token, paths reais, as tools de leitura e a operação do card (horas, comentário, etiqueta, anexo, checklist, repositório) via transporte in-memory do SDK.

## Operar um card

Quase todas as tools de escrita pedem `card_uuid` + `board_uuid` (ou `board` pelo nome). A coluna é lida automaticamente em `GET /quadro/{uuid}/card/{uuid}`.

### Criar e registrar o que foi feito

Use `bticket_create_card` no final de uma missão, por exemplo:

> faça isso na tarefa X, projeto Sistema Secretaria, e depois crie um card para registrar 2 horas e o que foi feito

Campos principais:

- `titulo` — obrigatório
- `descricao` — texto puro (sem HTML) com o pedido e o que foi feito
- `qtd_horas` — lança na API via `PUT` `qtd_horas` (não manda hora no POST de criação)
- `projeto` / `cliente` / `board` / `coluna` — por nome ou id
- `data_prazo`, `data_inicio`, `data_entrega` — `YYYY-MM-DD`
- `etiqueta` — aplica (e cria no quadro se ainda não existir)
- `comentario` — comentário inicial
- `atribuir_a_mim` — ligado por padrão

### Atualizar um card existente

- `bticket_get_card` — lê o card completo (horas, comentários, anexos, etiquetas, checklists, projeto)
- `bticket_update_card` — prazo, cliente, projeto, título, descrição, datas, arquivar
- `bticket_add_hours` / `bticket_delete_hours` — lançamentos de `card_horas`
- `bticket_add_comment` — criar, editar (`comentario_id`) ou excluir (`excluir=true`)
- `bticket_toggle_label` / `bticket_toggle_member` — liga/desliga
- `bticket_move_card` — muda de coluna pelo nome (ex.: `Desenvolvimento`, `Concluído`)
- `bticket_add_attachment` — `arquivo_caminho` no disco **ou** `arquivo_base64` + `arquivo_nome`
- `bticket_add_checklist` / `bticket_toggle_checklist_item`

### Repositório

O card **não** tem `repositorio_id`. O vínculo GitHub é no **projeto** (`POST /api/projeto/{id}/repositorios`). Use `bticket_list_repositories` para buscar e `bticket_link_repository` com `projeto` ou `card_uuid` (herda o projeto do card).

## Segurança

- `.env` está no `.gitignore`. Só `.env.example` com placeholders entra no git.
- No Cursor, as credenciais ficam só no `env` de `mcpServers.bticket` (ou `BTICKET_TOKEN` no mesmo objeto).
- Prefira `BTICKET_TOKEN` de escopo limitado em produção.
- Hoste o MCP remoto só em HTTPS e em rede confiável: quem chama o MCP herda o acesso B-Ticket daquele processo.
