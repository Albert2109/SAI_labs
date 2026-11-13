from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload
from models.desk import Desk
from models.card import Card


def save_flashcards_to_db(
    db: Session,
    user_id: int,
    desk_name: str,
    original_text: str,
    cards_list: list[dict],
) -> Desk:
    """
    Зберігає нову колоду та всі її картки в базу.
    """
    # 1. Створюємо саму колоду (Desk) і прив'язуємо до юзера
    new_desk = Desk(desk_name=desk_name, desk_text=original_text, user_id=user_id)
    db.add(new_desk)
    db.commit()
    db.refresh(new_desk)  # Оновлюємо, щоб база видала нам згенерований desk_id

    # 2. Проходимося по масиву карток від LLM і створюємо об'єкти Card
    for card_data in cards_list:
        new_card = Card(
            card_name=card_data["question"],  # питання
            card_text=card_data["answer"],  # відповідь
            desk_id=new_desk.desk_id,  # прив'язка до щойно створеної колоди
        )
        db.add(new_card)

    # 3. Зберігаємо всі картки одним махом
    db.commit()

    return new_desk


def get_user_desks_with_cards(db: Session, user_id: int):
    """
    Витягує всі колоди конкретного юзера разом із картками.
    joinedload потрібен, щоб SQLAlchemy дістала картки відразу одним SQL-запитом,
    а не робила 100 окремих запитів (оптимізація!).
    """
    desks = (
        db.query(Desk)
        .filter(Desk.user_id == user_id)
        .options(joinedload(Desk.cards))  # Одразу підтягуємо картки через relationship
        .all()
    )
    return desks



def delete_user_desk(db: Session, user_id: int, desk_id: int) -> bool:
    """Видаляє колоду користувача разом із її картками."""
    desk = (
        db.query(Desk)
        .filter(Desk.desk_id == desk_id, Desk.user_id == user_id)
        .first()
    )
    if not desk:
        return False
    db.query(Card).filter(Card.desk_id == desk_id).delete()
    db.delete(desk)
    db.commit()
    return True



def delete_user_desk(db: Session, user_id: int, desk_id: int) -> bool:
    """Видаляє колоду користувача разом із її картками."""
    desk = (
        db.query(Desk)
        .filter(Desk.desk_id == desk_id, Desk.user_id == user_id)
        .first()
    )
    if not desk:
        return False
    db.query(Card).filter(Card.desk_id == desk_id).delete()
    db.delete(desk)
    db.commit()
    return True

