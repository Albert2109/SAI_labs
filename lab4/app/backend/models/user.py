from typing import TYPE_CHECKING
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String

if TYPE_CHECKING:
    from models.desk import Desk  # ЗМІНЕНО


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    users_id: Mapped[int] = mapped_column(primary_key=True)
    users_name: Mapped[str] = mapped_column(String(30), unique=True)
    password_hash: Mapped[str] = mapped_column(String)

    desks: Mapped[list["Desk"]] = relationship(back_populates="user")
