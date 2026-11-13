import React from "react";
import { Layers, Trash2, RefreshCw } from "lucide-react";
import { Desk } from "../types";

interface DeckListProps {
  desks: Desk[];
  selectedDeskId: number | null;
  loading: boolean;
  onSelect: (deskId: number) => void;
  onDelete: (deskId: number) => void;
  onRefresh: () => void;
}

export const DeckList: React.FC<DeckListProps> = ({
  desks,
  selectedDeskId,
  loading,
  onSelect,
  onDelete,
  onRefresh,
}) => {
  return (
    <div className="panel decks-sidebar">
      <div className="panel-header">
        <div className="panel-title">
          <Layers size={18} />
          <h2>Мої колоди ({desks.length})</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          disabled={loading}
          title="Оновити список колод"
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {desks.length === 0 ? (
        <div className="empty-state small">
          <p>У вас ще немає збережених колод.</p>
          <span>Згенеруйте першу колоду зліва!</span>
        </div>
      ) : (
        <ul className="deck-list">
          {desks.map((desk) => {
            const isSelected = desk.desk_id === selectedDeskId;
            return (
              <li
                key={desk.desk_id}
                className={`deck-item ${isSelected ? "active" : ""}`}
                onClick={() => onSelect(desk.desk_id)}
              >
                <div className="deck-item-info">
                  <span className="deck-name">{desk.desk_name}</span>
                  <span className="deck-count">
                    {desk.cards.length}{" "}
                    {desk.cards.length === 1
                      ? "картка"
                      : desk.cards.length < 5
                        ? "картки"
                        : "карток"}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Видалити колоду"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(desk.desk_id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
