import { AppError, Desk, ErrorCode, HealthStatus, StreamEvent } from "../types";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export class ApiClientError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function mapNetworkError(err: unknown): ApiClientError {
  if (err instanceof ApiClientError) {
    return err;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiClientError("aborted", "Генерацію скасовано користувачем.");
  }
  if (err instanceof TypeError) {
    return new ApiClientError(
      "backend_offline",
      `Бекенд-сервер не запущено або недоступний за адресою ${API_BASE_URL}. Переконайтеся, що FastAPI працює.`
    );
  }
  return new ApiClientError(
    "unknown",
    err instanceof Error ? err.message : "Невідома помилка."
  );
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: { msg?: string }) => item.msg || "Помилка валідації")
        .join("; ");
    }
  } catch {
    // ignore JSON parse failure
  }
  return `Помилка сервера (HTTP ${response.status})`;
}

export async function checkHealth(): Promise<HealthStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new ApiClientError("unknown", "Бекенд повернув помилку.");
    }
    return (await response.json()) as HealthStatus;
  } catch (err) {
    throw mapNetworkError(err);
  }
}

export async function loginUser(
  username: string,
  password: string
): Promise<string> {
  try {
    const body = new URLSearchParams();
    body.append("username", username);
    body.append("password", password);

    const response = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      throw new ApiClientError(
        response.status === 401 ? "unauthorized" : "unknown",
        detail
      );
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  } catch (err) {
    throw mapNetworkError(err);
  }
}

export async function registerUser(
  username: string,
  password: string
): Promise<void> {
  try {
    const params = new URLSearchParams({
      username,
      passw: password,
    });

    const response = await fetch(`${API_BASE_URL}/register?${params.toString()}`, {
      method: "POST",
    });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      throw new ApiClientError("unknown", detail);
    }
  } catch (err) {
    throw mapNetworkError(err);
  }
}

export async function fetchDesks(token: string): Promise<Desk[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/desks`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      throw new ApiClientError(
        "unauthorized",
        "Термін дії сесії минув. Будь ласка, увійдіть знову."
      );
    }
    if (!response.ok) {
      throw new ApiClientError("unknown", await parseErrorDetail(response));
    }

    return (await response.json()) as Desk[];
  } catch (err) {
    throw mapNetworkError(err);
  }
}

export async function deleteDesk(token: string, deskId: number): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/desks/${deskId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      throw new ApiClientError(
        "unauthorized",
        "Термін дії сесії минув. Будь ласка, увійдіть знову."
      );
    }
    if (!response.ok) {
      throw new ApiClientError("unknown", await parseErrorDetail(response));
    }
  } catch (err) {
    throw mapNetworkError(err);
  }
}

export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: AppError) => void;
}

export async function generateDeckStream(
  token: string,
  payload: { desk_name: string; text: string; max_tokens: number },
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/generate/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (response.status === 401) {
      callbacks.onError({
        code: "unauthorized",
        message: "Термін дії сесії минув. Будь ласка, увійдіть знову.",
      });
      return;
    }

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      const code: ErrorCode =
        response.status === 503
          ? "server_unavailable"
          : response.status === 504
            ? "timeout"
            : response.status === 502
              ? "invalid_response"
              : "unknown";
      callbacks.onError({ code, message: detail });
      return;
    }

    if (!response.body) {
      callbacks.onError({
        code: "unknown",
        message: "Браузер не підтримує потокове читання відповіді.",
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;

        const jsonStr = line.slice("data:".length).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as StreamEvent;
          callbacks.onEvent(event);
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }
  } catch (err) {
    const mapped = mapNetworkError(err);
    callbacks.onError({ code: mapped.code, message: mapped.message });
  }
}
