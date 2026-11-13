import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Square,
  AlertTriangle,
  AlertCircle,
  WifiOff,
  Clock,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { generateDeckStream } from "../api/client";
import { AppError, Desk, GenerationStage } from "../types";

interface GeneratorPanelProps {
  token: string;
  onDeskCreated: (desk: Desk) => void;
  onUnauthorized: () => void;
}

const MIN_TOKENS = 128;
const MAX_TOKENS = 4096;
const DEFAULT_TOKENS = 1024;
const MAX_WORDS = 500;

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const SAMPLE_TEXT = `Штучна нейронна мережа (ШНМ) — це математична модель, побудована за принципом організації та функціонування біологічних нейронних мереж.
Основним елементом мережі є штучний нейрон, який отримує вхідні сигнали, множить їх на відповідні ваги, додає зміщення (bias) та пропускає результат через функцію активації (наприклад, ReLU або Sigmoid).
Навчання нейронної мережі зазвичай відбувається за допомогою алгоритму зворотного поширення помилки (backpropagation) та методу градієнтного спуску, які мінімізують функцію втрат.`;

const STAGES: { key: Exclude<GenerationStage, "idle" | "done" | "error">; label: string }[] = [
  { key: "connecting", label: "Підключення до LLM" },
  { key: "translating_in", label: "Переклад (UK → EN)" },
  { key: "generating", label: "Генерація моделлю" },
  { key: "parsing", label: "Переклад карток (EN → UK)" },
  { key: "saving", label: "Збереження в БД" },
];

export const GeneratorPanel: React.FC<GeneratorPanelProps> = ({
  token,
  onDeskCreated,
  onUnauthorized,
}) => {
  const [deskName, setDeskName] = useState("");
  const [text, setText] = useState("");
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_TOKENS);

  const [stage, setStage] = useState<GenerationStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [chunkProgress, setChunkProgress] = useState<{
    index?: number;
    total?: number;
  }>({});
  const [streamedText, setStreamedText] = useState<string>("");
  const [error, setError] = useState<AppError | null>(null);
  const [truncatedWarning, setTruncatedWarning] = useState(false);
  const [lastCreatedCount, setLastCreatedCount] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLPreElement | null>(null);

  const wordCount = countWords(text);
  const isOverWordLimit = wordCount > MAX_WORDS;
  const isGenerating =
    stage !== "idle" && stage !== "done" && stage !== "error";

  useEffect(() => {
    if (streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
    }
  }, [streamedText]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleTokensChange = (val: number) => {
    if (Number.isNaN(val)) return;
    setMaxTokens(Math.max(MIN_TOKENS, Math.min(MAX_TOKENS, val)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTruncatedWarning(false);
    setLastCreatedCount(null);

    const trimmedName = deskName.trim();
    const trimmedText = text.trim();

    if (!trimmedName) {
      setError({ code: "unknown", message: "Вкажіть назву колоди." });
      return;
    }
    if (trimmedText.length < 20) {
      setError({
        code: "unknown",
        message: "Введіть навчальний текст (щонайменше 20 символів).",
      });
      return;
    }
    if (isOverWordLimit) {
      setError({
        code: "too_many_words",
        message: `Перевищено ліміт у ${MAX_WORDS} слів (зараз: ${wordCount}). Скоротіть текст.`,
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setStage("connecting");
    setStatusMessage("Ініціалізація генерації...");
    setChunkProgress({});
    setStreamedText("");

    await generateDeckStream(
      token,
      {
        desk_name: trimmedName,
        text: trimmedText,
        max_tokens: maxTokens,
      },
      {
        onEvent: (event) => {
          if (event.type === "status") {
            setStage(event.stage);
            setStatusMessage(event.message);
            if (event.total_chunks) {
              setChunkProgress({
                index: event.chunk_index,
                total: event.total_chunks,
              });
            }
          } else if (event.type === "token") {
            setStreamedText((prev) => prev + event.content);
          } else if (event.type === "done") {
            setStage("done");
            setStatusMessage(
              `Готово! Згенеровано та збережено ${event.cards_count} карток.`
            );
            setLastCreatedCount(event.cards_count);
            setTruncatedWarning(event.truncated);
            setDeskName("");
            setText("");
            onDeskCreated({
              desk_id: event.desk_id,
              desk_name: event.desk_name,
              cards: event.cards,
            });
          } else if (event.type === "error") {
            setStage("error");
            setError({ code: event.code, message: event.message });
          }
        },
        onError: (err) => {
          if (err.code === "unauthorized") {
            onUnauthorized();
            return;
          }
          setStage("error");
          setError(err);
        },
      },
      controller.signal
    );

    abortRef.current = null;
  };

  const renderErrorIcon = (code: AppError["code"]) => {
    switch (code) {
      case "backend_offline":
      case "server_unavailable":
        return <WifiOff size={18} />;
      case "timeout":
        return <Clock size={18} />;
      case "invalid_response":
        return <AlertTriangle size={18} />;
      default:
        return <AlertCircle size={18} />;
    }
  };

  const currentStageIdx = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="panel generator-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Sparkles size={18} className="accent-icon" />
          <h2>Створити нову колоду</h2>
        </div>
        <button
          type="button"
          className="btn-ghost small"
          onClick={() => {
            if (!deskName) setDeskName("Штучні нейронні мережі");
            setText(SAMPLE_TEXT);
          }}
          disabled={isGenerating}
        >
          <FileText size={14} />
          Вставити приклад
        </button>
      </div>

      <form onSubmit={handleSubmit} className="generator-form">
        <div className="form-group">
          <label htmlFor="desk-name">Назва колоди</label>
          <input
            id="desk-name"
            type="text"
            value={deskName}
            onChange={(e) => setDeskName(e.target.value)}
            placeholder="Наприклад: Основи машинного навчання"
            disabled={isGenerating}
          />
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="source-text">Навчальний текст (українською)</label>
            <span className={`char-count ${isOverWordLimit ? "over-limit" : ""}`}>
              {wordCount} / {MAX_WORDS} слів
            </span>
          </div>
          <textarea
            id="source-text"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Вставте конспект або статтю (до 500 слів). Бекенд автоматично розіб'є текст на пачки для стабільної генерації..."
            disabled={isGenerating}
            className={isOverWordLimit ? "input-error" : ""}
          />
          {isOverWordLimit && (
            <span className="field-error">
              Перевищено ліміт: приберіть {wordCount - MAX_WORDS} слів.
            </span>
          )}
        </div>

        <div className="token-limit-box">
          <div className="token-limit-header">
            <div className="token-limit-title">
              <ShieldCheck size={16} className="accent-icon" />
              <span>Ліміт токенів (max_tokens)</span>
              <span className="badge-required">Обовʼязково</span>
            </div>
            <input
              type="number"
              className="token-number-input"
              min={MIN_TOKENS}
              max={MAX_TOKENS}
              step={64}
              value={maxTokens}
              onChange={(e) => handleTokensChange(Number(e.target.value))}
              disabled={isGenerating}
            />
          </div>
          <input
            type="range"
            min={MIN_TOKENS}
            max={MAX_TOKENS}
            step={64}
            value={maxTokens}
            onChange={(e) => handleTokensChange(Number(e.target.value))}
            disabled={isGenerating}
            className="token-slider"
          />
          <div className="token-limit-hints">
            <span>{MIN_TOKENS} (коротко)</span>
            <span>Запобігає зацикленню малої моделі</span>
            <span>{MAX_TOKENS} (макс.)</span>
          </div>
        </div>

        <div className="form-actions">
          {!isGenerating ? (
            <button
              type="submit"
              className="btn-primary full-width"
              disabled={isOverWordLimit}
            >
              <Sparkles size={16} />
              Згенерувати флеш-картки
            </button>
          ) : (
            <button
              type="button"
              className="btn-danger full-width"
              onClick={handleCancel}
            >
              <Square size={15} />
              Зупинити генерацію
            </button>
          )}
        </div>
      </form>

      {stage !== "idle" && (
        <div className="progress-card">
          <div className="progress-header">
            {isGenerating ? (
              <Loader2 size={17} className="spin accent-icon" />
            ) : stage === "done" ? (
              <CheckCircle2 size={17} className="success-icon" />
            ) : (
              <AlertCircle size={17} className="error-icon" />
            )}
            <span className="progress-message">{statusMessage}</span>
            {chunkProgress.total && chunkProgress.total > 1 && (
              <span className="badge-required" style={{ marginLeft: "auto" }}>
                {chunkProgress.index
                  ? `Пачка ${chunkProgress.index}/${chunkProgress.total}`
                  : `Пачок: ${chunkProgress.total}`}
              </span>
            )}
          </div>

          <div className="stages-track">
            {STAGES.map((s, idx) => {
              const isDone =
                stage === "done" ||
                (currentStageIdx !== -1 && idx < currentStageIdx);
              const isActive = s.key === stage;
              return (
                <div
                  key={s.key}
                  className={`stage-pill ${isDone ? "done" : ""} ${
                    isActive ? "active" : ""
                  }`}
                >
                  {s.label}
                </div>
              );
            })}
          </div>

          {streamedText && (
            <div className="stream-preview">
              <div className="stream-preview-label">
                <span>Потік відповіді моделі (JSON)</span>
                <span>~{Math.ceil(streamedText.length / 4)} токенів</span>
              </div>
              <pre ref={streamBoxRef} className="stream-box">
                {streamedText}
                {isGenerating && stage === "generating" && (
                  <span className="cursor-blink">▌</span>
                )}
              </pre>
            </div>
          )}
        </div>
      )}

      {truncatedWarning && (
        <div className="alert warning">
          <AlertTriangle size={18} />
          <span>
            Модель досягла ліміту ({maxTokens} токенів). Усі коректно сформовані
            картки ({lastCreatedCount}) збережено.
          </span>
        </div>
      )}

      {error && (
        <div className="alert error">
          {renderErrorIcon(error.code)}
          <div>
            <strong>Помилка генерації</strong>
            <p>{error.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};
