import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  LogOut,
  RefreshCw,
  Server,
  Cpu,
  User as UserIcon,
  WifiOff,
} from "lucide-react";
import {
  ApiClientError,
  checkHealth,
  deleteDesk,
  fetchDesks,
} from "./api/client";
import { AuthForm } from "./components/AuthForm";
import { DeckList } from "./components/DeckList";
import { GeneratorPanel } from "./components/GeneratorPanel";
import { StudyViewer } from "./components/StudyViewer";
import { Desk, HealthStatus } from "./types";

const TOKEN_KEY = "flashcards_token";
const USER_KEY = "flashcards_username";

export function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );
  const [username, setUsername] = useState<string | null>(() =>
    localStorage.getItem(USER_KEY)
  );

  const [desks, setDesks] = useState<Desk[]>([]);
  const [selectedDeskId, setSelectedDeskId] = useState<number | null>(null);
  const [desksLoading, setDesksLoading] = useState(false);
  const [desksError, setDesksError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await checkHealth();
      setHealth(data);
      setBackendOffline(false);
    } catch {
      setHealth(null);
      setBackendOffline(true);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUsername(null);
    setDesks([]);
    setSelectedDeskId(null);
  }, []);

  const loadDesks = useCallback(async () => {
    if (!token) return;
    setDesksLoading(true);
    setDesksError(null);
    try {
      const data = await fetchDesks(token);
      setDesks(data);
      if (data.length > 0) {
        setSelectedDeskId((prev) =>
          prev && data.some((d) => d.desk_id === prev) ? prev : data[0].desk_id
        );
      } else {
        setSelectedDeskId(null);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "unauthorized") {
          handleLogout();
          return;
        }
        setDesksError(err.message);
      } else {
        setDesksError("Не вдалося завантажити колоди.");
      }
    } finally {
      setDesksLoading(false);
    }
  }, [token, handleLogout]);

  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 15000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    if (token) {
      loadDesks();
    }
  }, [token, loadDesks]);

  const handleAuthSuccess = (newToken: string, newUsername: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, newUsername);
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleDeskCreated = (newDesk: Desk) => {
    setDesks((prev) => [newDesk, ...prev]);
    setSelectedDeskId(newDesk.desk_id);
  };

  const handleDeleteDesk = async (deskId: number) => {
    if (!token) return;
    try {
      await deleteDesk(token, deskId);
      setDesks((prev) => {
        const next = prev.filter((d) => d.desk_id !== deskId);
        if (selectedDeskId === deskId) {
          setSelectedDeskId(next[0]?.desk_id ?? null);
        }
        return next;
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "unauthorized") {
        handleLogout();
      } else if (err instanceof ApiClientError) {
        setDesksError(err.message);
      }
    }
  };

  const selectedDesk =
    desks.find((d) => d.desk_id === selectedDeskId) ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <div className="brand-icon">
              <BookOpen size={20} />
            </div>
            <span className="brand-name">FlashCard AI</span>
          </div>

          <div className="status-badges">
            <span
              className={`status-pill ${
                backendOffline ? "offline" : health ? "online" : "checking"
              }`}
              title="Статус FastAPI бекенду (порт 8000)"
            >
              <Server size={13} />
              {backendOffline
                ? "Бекенд офлайн"
                : health
                  ? "Бекенд OK"
                  : "Перевірка..."}
            </span>

            {!backendOffline && health && (
              <span
                className={`status-pill ${
                  health.llm_online ? "online" : "warn"
                }`}
                title="Статус llama-server (порт 9931)"
              >
                <Cpu size={13} />
                {health.llm_online
                  ? `LLM: ${health.model ?? "активна"}`
                  : "LLM не запущено (:9931)"}
              </span>
            )}

            <button
              type="button"
              className="icon-btn"
              onClick={refreshHealth}
              disabled={healthLoading}
              title="Перевірити з'єднання"
            >
              <RefreshCw size={14} className={healthLoading ? "spin" : ""} />
            </button>
          </div>
        </div>

        {token && (
          <div className="topbar-right">
            <div className="user-pill">
              <UserIcon size={14} />
              <span>{username}</span>
            </div>
            <button
              type="button"
              className="btn-ghost small"
              onClick={handleLogout}
            >
              <LogOut size={15} />
              Вийти
            </button>
          </div>
        )}
      </header>

      {!token ? (
        <AuthForm onSuccess={handleAuthSuccess} />
      ) : (
        <main className="workspace">
          {desksError && (
            <div className="alert error workspace-banner">
              <WifiOff size={18} />
              <span>{desksError}</span>
            </div>
          )}

          <div className="workspace-grid">
            <div className="left-column">
              <GeneratorPanel
                token={token}
                onDeskCreated={handleDeskCreated}
                onUnauthorized={handleLogout}
              />
              <DeckList
                desks={desks}
                selectedDeskId={selectedDeskId}
                loading={desksLoading}
                onSelect={setSelectedDeskId}
                onDelete={handleDeleteDesk}
                onRefresh={loadDesks}
              />
            </div>

            <div className="right-column">
              <StudyViewer desk={selectedDesk} />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
