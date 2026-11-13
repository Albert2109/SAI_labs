from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.user import Base
import models.user
import models.desk
import models.card

SQLALCHEMY_DATABASE_URL = "sqlite:///./flashcards.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Створюємо таблиці у файлі flashcards.db
Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
