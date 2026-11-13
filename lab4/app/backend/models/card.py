from typing import TYPE_CHECKING
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, ForeignKey
from models.user import Base  # ЗМІНЕНО

if TYPE_CHECKING:
    from models.desk import Desk  # ЗМІНЕНО


class Card(Base):
    __tablename__ = "cards"

    card_id: Mapped[int] = mapped_column(primary_key=True)
    card_name: Mapped[str] = mapped_column(String)
    card_text: Mapped[str] = mapped_column(String)

    desk_id: Mapped[int] = mapped_column(ForeignKey("desks.desk_id"))
    desk: Mapped["Desk"] = relationship(back_populates="cards")
