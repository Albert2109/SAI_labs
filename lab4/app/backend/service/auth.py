from sqlalchemy.orm import Session
from models.user import User
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from database import get_db

SECRET_KEY = "my_super_secret_flashcard_key_123"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def registration(name: str, password: str, db: Session) -> bool:
    # ЗМІНЕНО: User.users_name
    existing_user = db.query(User).filter(User.users_name == name).first()
    if existing_user:
        return False

    hashed_pwd = pwd_context.hash(password)
    new_user = User(users_name=name, password_hash=hashed_pwd)
    try:
        db.add(new_user)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        print(f"Помилка БД: {e}")
        return False


def login(name: str, password: str, db: Session) -> bool:
    existing_user = db.query(User).filter(User.users_name == name).first()
    if not existing_user:
        return False

    if pwd_context.verify(password, existing_user.password_hash):
        return True
    else:
        return False


def create_access_token(data: dict) -> str:

    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    return encoded_jwt


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Недійсний токен або термін його дії минув",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Розшифровуємо токен твоїм секретним ключем
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception

    # Шукаємо юзера в базі по імені з токена
    user = db.query(User).filter(User.users_name == username).first()
    if user is None:
        raise credentials_exception

    return user
