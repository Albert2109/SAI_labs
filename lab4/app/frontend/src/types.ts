export interface Card {
  question: string;
  answer: string;
}

export interface Desk {
  desk_id: number;
  desk_name: string;
  cards: Card[];
}

export interface HealthStatus {
  status: string;
  llm_online: boolean;
  model: string | null;
}

export type GenerationStage =
  | "idle"
  | "connecting"
  | "translating_in"
  | "generating"
  | "parsing"
  | "saving"
  | "done"
  | "error";

export type ErrorCode =
  | "backend_offline"
  | "server_unavailable"
  | "timeout"
  | "invalid_response"
  | "translation_error"
  | "too_many_words"
  | "nonsense_input"
  | "unauthorized"
  | "aborted"
  | "unknown";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type StreamEvent =
  | {
      type: "status";
      stage: Exclude<GenerationStage, "idle" | "done" | "error">;
      message: string;
      model?: string;
      max_tokens?: number;
      chunk_index?: number;
      total_chunks?: number;
    }
  | {
      type: "token";
      content: string;
    }
  | {
      type: "done";
      desk_id: number;
      desk_name: string;
      cards_count: number;
      cards: Card[];
      truncated: boolean;
    }
  | {
      type: "error";
      code: ErrorCode;
      message: string;
    };
