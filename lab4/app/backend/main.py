import json
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from service.auth import registration, login, create_access_token, get_current_user
from service.generator import (
    DEFAULT_MAX_TOKENS,
    MAX_MAX_TOKENS,
    MIN_MAX_TOKENS,
    GeneratorError,
    check_llm_health,
    clamp_max_tokens,
    generate_flashcards_pipeline,
    generate_flashcards_stream,
)
from service.crud import (
    delete_user_desk,
    get_user_desks_with_cards,
    save_flashcards_to_db,
)
from models.user import User

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    desk_name: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1)
    max_tokens: int = Field(
        default=DEFAULT_MAX_TOKENS,
        ge=MIN_MAX_TOKENS,
        le=MAX_MAX_TOKENS,
    )


@app.get("/")
async def root():
    return {"message": "API працює"}


@app.get("/health")
async def health():
    return {"status": "ok", **check_llm_health()}


@app.post("/register")
async def register_user(username: str, passw: str, db: Session = Depends(get_db)):
    success = registration(username, passw, db)
    if not success:
        raise HTTPException(
            status_code=400, detail="Користувач з таким іменем вже існує"
        )

    return {"message": "Успішно зареєстровано!"}


@app.post("/login")
async def login_user(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    isvalid = login(form_data.username, form_data.password, db)

    if not isvalid:
        raise HTTPException(status_code=401, detail="Неправильне ім'я або пароль")

    access_token = create_access_token(data={"sub": form_data.username})

    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/generate")
async def generate_and_save_desk(
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_max_tokens = clamp_max_tokens(payload.max_tokens)
    try:
        cards = generate_flashcards_pipeline(
            payload.text, max_tokens=effective_max_tokens
        )
    except GeneratorError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    new_desk = save_flashcards_to_db(
        db=db,
        user_id=current_user.users_id,
        desk_name=payload.desk_name.strip(),
        original_text=payload.text,
        cards_list=cards,
    )

    return {
        "message": "Успішно збережено!",
        "desk_id": new_desk.desk_id,
        "cards_count": len(cards),
        "cards": cards,
    }


@app.post("/generate/stream")
def generate_and_save_desk_stream(
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_max_tokens = clamp_max_tokens(payload.max_tokens)
    desk_name = payload.desk_name.strip()

    def sse_format(event_data: dict) -> str:
        return f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

    def event_stream():
        try:
            cards_result = None
            truncated = False

            for event in generate_flashcards_stream(
                payload.text, max_tokens=effective_max_tokens
            ):
                if event["type"] == "cards":
                    cards_result = event["cards"]
                    truncated = bool(event.get("truncated"))
                else:
                    yield sse_format(event)

            if not cards_result:
                yield sse_format(
                    {
                        "type": "error",
                        "code": "invalid_response",
                        "message": "Модель не повернула жодної картки.",
                    }
                )
                return

            yield sse_format(
                {
                    "type": "status",
                    "stage": "saving",
                    "message": "Збереження колоди в базу даних...",
                }
            )
            new_desk = save_flashcards_to_db(
                db=db,
                user_id=current_user.users_id,
                desk_name=desk_name,
                original_text=payload.text,
                cards_list=cards_result,
            )

            yield sse_format(
                {
                    "type": "done",
                    "desk_id": new_desk.desk_id,
                    "desk_name": new_desk.desk_name,
                    "cards_count": len(cards_result),
                    "cards": cards_result,
                    "truncated": truncated,
                }
            )
        except GeneratorError as e:
            yield sse_format(
                {
                    "type": "error",
                    "code": e.code,
                    "message": e.message,
                }
            )
        except Exception as e:
            yield sse_format(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": f"Внутрішня помилка сервера: {e}",
                }
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/desks")
async def get_desks(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    desks = get_user_desks_with_cards(db, current_user.users_id)

    result = []
    for desk in desks:
        result.append(
            {
                "desk_id": desk.desk_id,
                "desk_name": desk.desk_name,
                "cards": [
                    {"question": c.card_name, "answer": c.card_text}
                    for c in desk.cards
                ],
            }
        )

    return result


@app.delete("/desks/{desk_id}")
async def delete_desk(
    desk_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = delete_user_desk(db, current_user.users_id, desk_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Колоду не знайдено")
    return {"message": "Колоду видалено"}


@app.delete("/desks/{desk_id}")
async def delete_desk(
    desk_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = delete_user_desk(db, current_user.users_id, desk_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Колоду не знайдено")
    return {"message": "Колоду видалено"}

