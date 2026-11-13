import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  List,
  Layers,
  Shuffle,
  BookOpenCheck,
} from "lucide-react";
import { Card, Desk } from "../types";

interface StudyViewerProps {
  desk: Desk | null;
}

export const StudyViewer: React.FC<StudyViewerProps> = ({ desk }) => {
  const [viewMode, setViewMode] = useState<"study" | "list">("study");
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (desk) {
      setCards(desk.cards);
      setCurrentIndex(0);
      setFlipped(false);
    } else {
      setCards([]);
    }
  }, [desk]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!desk || viewMode !== "study" || cards.length === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        setFlipped(false);
        setCurrentIndex((i) => Math.min(cards.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        setFlipped(false);
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [desk, viewMode, cards.length]);

  if (!desk) {
    return (
      <div className="panel study-panel empty-study">
        <BookOpenCheck size={44} className="muted-icon" />
        <h3>Оберіть колоду або створіть нову</h3>
        <p>
          Тут з'являться ваші флеш-картки з інтерактивним режимом повторення
          (перегортання по кліку або клавішею Пробіл).
        </p>
      </div>
    );
  }

  const handleShuffle = () => {
    const copy = [...cards];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    setCards(copy);
    setCurrentIndex(0);
    setFlipped(false);
  };

  const currentCard = cards[currentIndex];
  const progressPct =
    cards.length > 0 ? ((currentIndex + 1) / cards.length) * 100 : 0;

  return (
    <div className="panel study-panel">
      <div className="panel-header">
        <div>
          <h2 className="study-title">{desk.desk_name}</h2>
          <span className="study-subtitle">{cards.length} карток у колоді</span>
        </div>

        <div className="study-controls">
          {viewMode === "study" && cards.length > 1 && (
            <button
              type="button"
              className="btn-ghost small"
              onClick={handleShuffle}
              title="Перемішати картки"
            >
              <Shuffle size={14} />
              Перемішати
            </button>
          )}
          <div className="segmented-toggle">
            <button
              type="button"
              className={viewMode === "study" ? "active" : ""}
              onClick={() => setViewMode("study")}
            >
              <Layers size={14} />
              Картки
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
            >
              <List size={14} />
              Список
            </button>
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="empty-state">
          <p>У цій колоді поки немає карток.</p>
        </div>
      ) : viewMode === "study" && currentCard ? (
        <div className="study-stage">
          <div className="study-progress-bar">
            <div
              className="study-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div
            className={`flashcard ${flipped ? "is-flipped" : ""}`}
            onClick={() => setFlipped((f) => !f)}
            role="button"
            tabIndex={0}
          >
            <div className="flashcard-inner">
              <div className="flashcard-face flashcard-front">
                <span className="card-side-badge">Питання</span>
                <p className="card-text">{currentCard.question}</p>
                <span className="card-hint">
                  <RotateCw size={13} /> Натисніть або Space, щоб побачити відповідь
                </span>
              </div>
              <div className="flashcard-face flashcard-back">
                <span className="card-side-badge answer">Відповідь</span>
                <p className="card-text">{currentCard.answer}</p>
                <span className="card-hint">
                  <RotateCw size={13} /> Натисніть, щоб повернутися до питання
                </span>
              </div>
            </div>
          </div>

          <div className="study-nav">
            <button
              type="button"
              className="btn-secondary"
              disabled={currentIndex === 0}
              onClick={() => {
                setFlipped(false);
                setCurrentIndex((i) => Math.max(0, i - 1));
              }}
            >
              <ChevronLeft size={16} />
              Попередня
            </button>

            <span className="study-counter">
              {currentIndex + 1} / {cards.length}
            </span>

            <button
              type="button"
              className="btn-secondary"
              disabled={currentIndex === cards.length - 1}
              onClick={() => {
                setFlipped(false);
                setCurrentIndex((i) => Math.min(cards.length - 1, i + 1));
              }}
            >
              Наступна
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="cards-list-view">
          {cards.map((card, idx) => (
            <div key={idx} className="list-card-item">
              <div className="list-card-num">#{idx + 1}</div>
              <div className="list-card-body">
                <div className="list-card-q">{card.question}</div>
                <div className="list-card-a">{card.answer}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
