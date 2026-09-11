export type CardFilters = {
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
};

export type RepositoryFilters = {
  q?: string;
  cliente_id?: string;
  projeto_id?: string;
  language?: string;
  topic?: string;
  papel?: string;
  vinculo?: string;
  arquivado?: boolean;
  ordenar?: string;
  page?: number;
  per_page?: number;
};

export type AttachmentFile = {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
