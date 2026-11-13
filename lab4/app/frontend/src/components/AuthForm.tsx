import React, { useState } from "react";
import { BookOpen, LogIn, UserPlus, AlertCircle, CheckCircle2 } from "lucide-react";
import { ApiClientError, loginUser, registerUser } from "../api/client";

interface AuthFormProps {
  onSuccess: (token: string, username: string) => void;
}

export const AuthForm: React.FC<AuthFormProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmedName = username.trim();
    if (!trimmedName || !password) {
      setError("Будь ласка, заповніть ім'я користувача та пароль.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "register") {
        await registerUser(trimmedName, password);
        setSuccessMsg("Акаунт створено! Виконуємо вхід...");
      }
      const token = await loginUser(trimmedName, password);
      onSuccess(token, trimmedName);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("Не вдалося виконати запит.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand-icon large">
            <BookOpen size={28} />
          </div>
          <h1>FlashCard AI</h1>
          <p>Генератор навчальних флеш-карток з локальною LLM</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError(null);
              setSuccessMsg(null);
            }}
          >
            <LogIn size={16} />
            Вхід
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register");
              setError(null);
              setSuccessMsg(null);
            }}
          >
            <UserPlus size={16} />
            Реєстрація
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">Ім'я користувача</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Наприклад, student_ai"
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={loading}
            />
          </div>

          {error && (
            <div className="alert error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="alert success">
              <CheckCircle2 size={18} />
              <span>{successMsg}</span>
            </div>
          )}

          <button type="submit" className="btn-primary full-width" disabled={loading}>
            {loading
              ? "Зачекайте..."
              : mode === "login"
                ? "Увійти"
                : "Зареєструватися"}
          </button>
        </form>
      </div>
    </div>
  );
};
