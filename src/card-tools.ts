import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BticketClient } from "./bticket/client.js";
import { BticketApiError, asRecord, extractResults } from "./bticket/errors.js";
import { clientsFromPayload, labelsFromPayload, membersFromPayload, toApiId } from "./bticket/resolve.js";
import {
  cardFieldBody,
  extractCreatedId,
  findChecklistItem,
  readAttachmentFile,
  resolveBoard,
  resolveCardTarget,
  resolveColumn,
  resolveLabel,
  resolveMember,
  resolveProjectAndClient,
  resolveRepository,
} from "./card-context.js";
import {
  booleanish,
  destructive,
  errorResult,
  jsonResult,
  readOnly,
  stringList,
  writeOnce,
} from "./mcp-util.js";

const cardLocatorShape = {
  card_uuid: z.string().min(1).describe("UUID do card (campo `id` na API)"),
  board_uuid: z.string().optional().describe("UUID do quadro"),
  board: z.string().optional().describe("Nome do quadro, se não passar board_uuid"),
  coluna_id: z.string().optional().describe("Id da coluna. Se omitido, é lido do card"),
};

const horasSchema = z.coerce.number().positive().describe("Quantidade de horas (ex.: 1.5)");

export function registerCardTools(server: McpServer, client: BticketClient): void {
  server.registerTool(
    "bticket_get_card",
    {
      title: "Obter card completo",
      description:
        "Lê um card com todos os detalhes: GET /api/quadro/{uuid}/card/{uuid}. Inclui título, descrição, prazo, cliente, projeto, fases, membros, etiquetas, checklists, anexos, comentários/atividades e horas lançadas.",
      inputSchema: z.object({
        card_uuid: z.string().min(1).describe("UUID do card"),
        board_uuid: z.string().optional().describe("UUID do quadro"),
        board: z.string().optional().describe("Nome do quadro"),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const board = await resolveBoard(client, args.board_uuid, args.board);
        const card = await client.getCard(board.id, args.card_uuid);
        return jsonResult({ board: { uuid: board.id, titulo: board.titulo }, card });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_update_card",
    {
      title: "Atualizar card",
      description:
        "Atualiza campos do card via PUT /coluna/{id}/card/{uuid}: título, descrição, data_prazo, data_inicio, data_entrega, cliente, projeto, fase, arquivado. Use qtd_horas para lançar um novo registro de horas (não substitui o total). Aceita projeto/cliente por nome.",
      inputSchema: z.object({
        ...cardLocatorShape,
        titulo: z.string().min(1).optional(),
        descricao: z.string().optional().describe("Texto puro, sem HTML"),
        data_prazo: z.string().optional().describe("YYYY-MM-DD"),
        data_inicio: z.string().optional().describe("YYYY-MM-DD"),
        data_entrega: z.string().optional().describe("YYYY-MM-DD"),
        arquivado: booleanish,
        qtd_horas: z.coerce.number().positive().optional().describe("Lança um novo registro de horas"),
        projeto_id: z.string().optional(),
        projeto: z.string().optional().describe("Nome do projeto"),
        cliente_id: z.string().optional(),
        cliente: z.string().optional().describe("Nome do cliente"),
        fase_id: z.string().optional().describe("Id da fase do projeto"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const refs = await resolveProjectAndClient(client, {
          projeto_id: args.projeto_id,
          projeto: args.projeto,
          cliente_id: args.cliente_id,
          cliente: args.cliente,
          boardUuid: target.board.id,
        });
        const body = cardFieldBody({
          titulo: args.titulo,
          descricao: args.descricao,
          data_prazo: args.data_prazo,
          data_inicio: args.data_inicio,
          data_entrega: args.data_entrega,
          arquivado: args.arquivado,
          qtd_horas: args.qtd_horas,
          cliente_id: refs.clienteId,
          projeto_id: refs.projetoId,
          fase_id: args.fase_id,
        });
        if (Object.keys(body).length === 0) {
          throw new BticketApiError(
            "Informe ao menos um campo para atualizar (titulo, descricao, data_prazo, cliente, projeto, qtd_horas, etc.).",
            400,
            null,
          );
        }
        const updated = await client.updateCard(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          body,
        );
        return jsonResult({
          ok: true,
          board: { uuid: target.board.id, titulo: target.board.titulo },
          card_uuid: target.cardUuid,
          projeto: refs.projetoId ? { id: refs.projetoId, nome: refs.projetoNome } : null,
          cliente: refs.clienteId ? { id: refs.clienteId, nome: refs.clienteNome } : null,
          updated,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_add_hours",
    {
      title: "Registrar horas no card",
      description:
        "Lança horas trabalhadas no card (PUT qtd_horas). A API cria um registro em card_horas para o usuário autenticado; o total do card é a soma desses lançamentos.",
      inputSchema: z.object({
        ...cardLocatorShape,
        qtd_horas: horasSchema,
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const updated = await client.updateCard(target.board.id, target.colunaId, target.cardUuid, {
          qtd_horas: args.qtd_horas,
        });
        return jsonResult({
          ok: true,
          card_uuid: target.cardUuid,
          qtd_horas: args.qtd_horas,
          updated,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_delete_hours",
    {
      title: "Remover lançamento de horas",
      description:
        "Remove um lançamento de horas (DELETE /api/card_hora/{id}). O id vem no array `horas` do card (bticket_get_card).",
      inputSchema: z.object({
        hora_id: z.string().min(1).describe("Id numérico do lançamento em card.horas[].id"),
      }),
      annotations: destructive,
    },
    async (args) => {
      try {
        return jsonResult({
          ok: true,
          deleted: await client.deleteHours(toApiId(args.hora_id)),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_add_comment",
    {
      title: "Comentar no card",
      description:
        "Cria um comentário no card (POST .../atividade) com descricao e menções opcionais (ids de usuários). Para editar/excluir, passe comentario_id.",
      inputSchema: z.object({
        ...cardLocatorShape,
        descricao: z.string().optional().describe("Texto do comentário. Obrigatório ao criar ou editar"),
        mencoes: z
          .array(z.coerce.number().int().positive())
          .optional()
          .describe("Ids de usuários mencionados no comentário"),
        comentario_id: z.string().optional().describe("Id da atividade/comentário para editar ou excluir"),
        excluir: booleanish.describe("true = DELETE do comentario_id"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        if (args.excluir) {
          if (!args.comentario_id) {
            throw new BticketApiError("Informe comentario_id para excluir.", 400, null);
          }
          const deleted = await client.deleteCardComment(
            target.board.id,
            target.colunaId,
            target.cardUuid,
            toApiId(args.comentario_id),
          );
          return jsonResult({ ok: true, deleted });
        }
        if (!args.descricao?.trim()) {
          throw new BticketApiError("Informe descricao do comentário.", 400, null);
        }
        if (args.comentario_id) {
          const updated = await client.updateCardComment(
            target.board.id,
            target.colunaId,
            target.cardUuid,
            toApiId(args.comentario_id),
            { descricao: args.descricao },
          );
          return jsonResult({ ok: true, updated });
        }
        const created = await client.addCardComment(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          { descricao: args.descricao, mencoes: args.mencoes },
        );
        return jsonResult({ ok: true, created });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_labels",
    {
      title: "Listar etiquetas do quadro",
      description:
        "Lista as etiquetas do quadro (GET /api/quadro/{uuid}/etiquetas). Use o id ou o título em bticket_toggle_label.",
      inputSchema: z.object({
        board_uuid: z.string().optional(),
        board: z.string().optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const board = await resolveBoard(client, args.board_uuid, args.board);
        const payload = await client.listBoardLabels(board.id);
        return jsonResult({
          board: { uuid: board.id, titulo: board.titulo },
          etiquetas: labelsFromPayload(payload),
          raw: payload,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_toggle_label",
    {
      title: "Ligar/desligar etiqueta no card",
      description:
        "Alterna uma etiqueta no card (PATCH .../etiqueta/{id}/toggle). Aceita nome ou id. Se a etiqueta não existir e criar=true, cria no quadro (titulo + cor) e depois aplica.",
      inputSchema: z.object({
        ...cardLocatorShape,
        etiqueta_id: z.string().optional(),
        etiqueta: z.string().optional().describe("Nome da etiqueta, ex.: Bug"),
        criar: booleanish.describe("true = cria a etiqueta no quadro se não existir"),
        cor: z.string().optional().describe("Cor hex ao criar, default #3498db"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const label = await resolveLabel(
          client,
          target.board.id,
          args.etiqueta_id,
          args.etiqueta,
          { createIfMissing: Boolean(args.criar), cor: args.cor },
        );
        const updated = await client.toggleCardLabel(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          toApiId(label.id),
        );
        return jsonResult({
          ok: true,
          etiqueta: { id: label.id, titulo: label.titulo },
          updated,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_clients",
    {
      title: "Listar clientes",
      description:
        "Lista clientes (GET /api/clientes?nome=) ou os clientes do quadro (GET /api/quadro/{uuid}/clientes) se informar board.",
      inputSchema: z.object({
        busca: z.string().optional().describe("Filtro pelo nome (query `nome`)"),
        board_uuid: z.string().optional(),
        board: z.string().optional(),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(500).optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        if (args.board_uuid || args.board) {
          const board = await resolveBoard(client, args.board_uuid, args.board);
          const payload = await client.listBoardClients(board.id);
          const clientes = clientsFromPayload(payload);
          const busca = args.busca?.trim().toLowerCase();
          const filtered = busca
            ? clientes.filter((item) => item.titulo.toLowerCase().includes(busca))
            : clientes;
          return jsonResult({
            origem: "quadro",
            board: { uuid: board.id, titulo: board.titulo },
            total: filtered.length,
            clientes: filtered,
          });
        }
        const payload = await client.listClients({
          nome: args.busca,
          page: args.page,
          per_page: args.per_page,
        });
        return jsonResult({ origem: "global", clientes: payload });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_members",
    {
      title: "Listar membros do quadro",
      description:
        "Lista membros do quadro (GET /api/quadro/{uuid}/membros). Use o id em bticket_toggle_member.",
      inputSchema: z.object({
        board_uuid: z.string().optional(),
        board: z.string().optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        const board = await resolveBoard(client, args.board_uuid, args.board);
        const payload = await client.listBoardMembers(board.id);
        return jsonResult({
          board: { uuid: board.id, titulo: board.titulo },
          membros: membersFromPayload(payload),
          raw: payload,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_toggle_member",
    {
      title: "Atribuir/remover membro do card",
      description:
        "Alterna um membro no card (PATCH .../membro/{user}/toggle). Use membro (nome), membro_id ou atribuir_a_mim=true.",
      inputSchema: z.object({
        ...cardLocatorShape,
        membro_id: z.string().optional(),
        membro: z.string().optional().describe("Nome do membro no quadro"),
        atribuir_a_mim: booleanish.describe("true = usa o usuário autenticado"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const assignSelf =
          args.atribuir_a_mim === true ||
          (args.atribuir_a_mim !== false && !args.membro_id && !args.membro);
        const member = await resolveMember(
          client,
          target.board.id,
          args.membro_id,
          args.membro,
          assignSelf,
        );
        const updated = await client.toggleCardMember(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          toApiId(member.id),
        );
        return jsonResult({
          ok: true,
          membro: { id: member.id, nome: member.titulo },
          updated,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_move_card",
    {
      title: "Mover card de coluna",
      description:
        "Move o card para outra coluna (PATCH /api/quadro/{uuid}/card/{uuid}/mover/{coluna_id}). Aceita coluna por nome (ex.: Desenvolvimento, Concluído).",
      inputSchema: z.object({
        ...cardLocatorShape,
        coluna_destino_id: z.string().optional(),
        coluna: z.string().optional().describe("Nome da coluna de destino"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const column = await resolveColumn(
          client,
          target.board.id,
          args.coluna_destino_id,
          args.coluna,
        );
        const moved = await client.moveCard(target.board.id, target.cardUuid, column.id);
        return jsonResult({
          ok: true,
          coluna: { id: column.id, titulo: column.titulo },
          moved,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_add_attachment",
    {
      title: "Anexar arquivo ao card",
      description:
        "Envia um anexo (POST multipart .../anexo, campo `arquivo`). Use arquivo_caminho (path local no Cursor) ou arquivo_base64 + arquivo_nome.",
      inputSchema: z.object({
        ...cardLocatorShape,
        arquivo_caminho: z.string().optional().describe("Caminho absoluto ou relativo do arquivo"),
        arquivo_base64: z.string().optional().describe("Conteúdo em base64, sem prefixo data:"),
        arquivo_nome: z.string().optional().describe("Nome do arquivo (obrigatório com base64)"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const file = await readAttachmentFile(args);
        const created = await client.addCardAttachment(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          file,
        );
        return jsonResult({
          ok: true,
          arquivo_nome: file.filename,
          created,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_delete_attachment",
    {
      title: "Remover anexo do card",
      description:
        "Remove um anexo (DELETE .../anexo/{uuid}). O uuid está em card.anexos[].id (bticket_get_card).",
      inputSchema: z.object({
        ...cardLocatorShape,
        anexo_uuid: z.string().min(1).describe("UUID do anexo"),
      }),
      annotations: destructive,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const deleted = await client.deleteCardAttachment(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          args.anexo_uuid,
        );
        return jsonResult({ ok: true, deleted });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_add_checklist",
    {
      title: "Checklist no card",
      description:
        "Cria um checklist (POST .../checklist) e, se informar itens, adiciona cada um. Se passar checklist_id, só adiciona itens ao checklist existente.",
      inputSchema: z.object({
        ...cardLocatorShape,
        titulo: z.string().optional().describe("Título do checklist (obrigatório ao criar)"),
        checklist_id: z.string().optional().describe("Id de um checklist já existente"),
        itens: stringList.describe("Itens de texto para adicionar"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        let checklistId = args.checklist_id;
        let created: unknown;
        if (!checklistId) {
          if (!args.titulo?.trim()) {
            throw new BticketApiError("Informe titulo para criar o checklist.", 400, null);
          }
          created = await client.createCardChecklist(
            target.board.id,
            target.colunaId,
            target.cardUuid,
            args.titulo,
          );
          checklistId = extractCreatedId(created, "Checklist");
        }

        const itensCriados = [];
        for (const descricao of args.itens ?? []) {
          itensCriados.push(
            await client.addChecklistItem(
              target.board.id,
              target.colunaId,
              target.cardUuid,
              toApiId(checklistId),
              descricao,
            ),
          );
        }

        return jsonResult({
          ok: true,
          checklist_id: checklistId,
          created: created ?? null,
          itens: itensCriados,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_toggle_checklist_item",
    {
      title: "Concluir item de checklist",
      description:
        "Marca/desmarca um item (PATCH .../item/{id}/toggle). Aceita checklist/item por id ou nome. Use bticket_get_card para ver os ids.",
      inputSchema: z.object({
        ...cardLocatorShape,
        checklist_id: z.string().optional(),
        checklist: z.string().optional().describe("Título do checklist"),
        item_id: z.string().optional(),
        item: z.string().optional().describe("Descrição do item"),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        const target = await resolveCardTarget(client, args);
        const found = findChecklistItem(
          target.card,
          args.checklist_id,
          args.checklist,
          args.item_id,
          args.item,
        );
        const updated = await client.toggleChecklistItem(
          target.board.id,
          target.colunaId,
          target.cardUuid,
          toApiId(found.checklistId),
          toApiId(found.itemId),
        );
        return jsonResult({ ok: true, ...found, updated });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_list_repositories",
    {
      title: "Listar repositórios",
      description:
        "Lista o catálogo GitHub sincronizado (GET /api/repositorios). Filtros: q, cliente_id, projeto_id, language, papel, vinculo. Repositórios ligam-se a projetos, não diretamente ao card — use bticket_link_repository.",
      inputSchema: z.object({
        q: z.string().optional().describe("Busca em nome, full_name e descrição"),
        cliente_id: z.string().optional(),
        projeto_id: z.string().optional(),
        projeto: z.string().optional(),
        language: z.string().optional(),
        topic: z.string().optional(),
        papel: z
          .enum(["backend", "frontend", "mobile", "infra", "legado", "monolito", "outro"])
          .optional(),
        vinculo: z.enum(["vinculado", "nao_vinculado"]).optional(),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(500).optional(),
      }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        let projetoId = args.projeto_id;
        if (!projetoId && args.projeto) {
          const refs = await resolveProjectAndClient(client, { projeto: args.projeto });
          projetoId = refs.projetoId;
        }
        const payload = await client.listRepositories({
          q: args.q,
          cliente_id: args.cliente_id,
          projeto_id: projetoId,
          language: args.language,
          topic: args.topic,
          papel: args.papel,
          vinculo: args.vinculo,
          page: args.page,
          per_page: args.per_page,
        });
        return jsonResult(payload);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "bticket_link_repository",
    {
      title: "Vincular repositório ao projeto do card",
      description:
        "Vincula um repositório GitHub a um projeto (POST /api/projeto/{id}/repositorios). O card não tem repositorio_id próprio: o vínculo é no projeto. Informe o projeto ou um card para herdar o projeto_id.",
      inputSchema: z.object({
        repositorio_id: z.string().optional(),
        repositorio: z.string().optional().describe("Nome ou full_name, ex.: b-ticket-backend"),
        papel: z
          .enum(["backend", "frontend", "mobile", "infra", "legado", "monolito", "outro"])
          .optional()
          .describe("Default: backend"),
        observacoes: z.string().optional(),
        projeto_id: z.string().optional(),
        projeto: z.string().optional(),
        card_uuid: z.string().optional().describe("Se informado, herda o projeto_id do card"),
        board_uuid: z.string().optional(),
        board: z.string().optional(),
      }),
      annotations: writeOnce,
    },
    async (args) => {
      try {
        let projetoId = args.projeto_id;
        let projetoNome: string | undefined;

        if (args.card_uuid) {
          const target = await resolveCardTarget(client, {
            card_uuid: args.card_uuid,
            board_uuid: args.board_uuid,
            board: args.board,
          });
          const card = asRecord(extractResults(target.card));
          const projeto = asRecord(card?.projeto);
          if (!projetoId && projeto?.id != null) {
            projetoId = String(projeto.id);
            projetoNome = typeof projeto.nome === "string" ? projeto.nome : undefined;
          }
        }

        if (!projetoId || args.projeto) {
          const refs = await resolveProjectAndClient(client, {
            projeto_id: projetoId,
            projeto: args.projeto,
          });
          projetoId = refs.projetoId ?? projetoId;
          projetoNome = refs.projetoNome ?? projetoNome;
        }

        if (!projetoId) {
          throw new BticketApiError(
            "Informe projeto, projeto_id ou um card_uuid que já tenha projeto.",
            400,
            null,
          );
        }

        const repo = await resolveRepository(client, args.repositorio_id, args.repositorio, projetoId);
        const linked = await client.linkProjectRepositories(toApiId(projetoId), [
          {
            repositorio_id: Number(repo.id),
            papel: args.papel ?? "backend",
            observacoes: args.observacoes,
          },
        ]);
        return jsonResult({
          ok: true,
          projeto: { id: projetoId, nome: projetoNome },
          repositorio: { id: repo.id, nome: repo.titulo },
          linked,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
