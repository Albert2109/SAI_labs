from typing import TYPE_CHECKING
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, ForeignKey
from models.user import Base

if TYPE_CHECKING:
    from models.card import Card


class Desk(Base):
    __tablename__ = "desks"

    desk_id: Mapped[int] = mapped_column(primary_key=True)
    desk_name: Mapped[str] = mapped_column(String(100))
    desk_text: Mapped[str] = mapped_column(String)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.users_id"))
    user: Mapped["User"] = relationship(back_populates="desks")
    cards: Mapped[list["Card"]] = relationship(back_populates="desk")
