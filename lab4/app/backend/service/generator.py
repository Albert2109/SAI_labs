import json
import re
import time
from typing import Generator
import requests
from deep_translator import MyMemoryTranslator

LLM_URL = "http://127.0.0.1:9931/v1/chat/completions"
MODELS_URL = "http://127.0.0.1:9931/v1/models"

DEFAULT_MAX_TOKENS = 1024
MIN_MAX_TOKENS = 128
MAX_MAX_TOKENS = 4096

MAX_INPUT_WORDS = 500
CHUNK_MAX_WORDS = 90
CHUNK_MAX_CHARS = 450

CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 120


class GeneratorError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class InputTooLongError(GeneratorError):
    def __init__(
        self,
        word_count: int,
        max_words: int = MAX_INPUT_WORDS,
    ):
        super().__init__(
            "too_many_words",
            f"Текст перевищує ліміт у {max_words} слів (зараз: {word_count}). Скоротіть текст.",
            status_code=400,
        )


class InvalidInputTextError(GeneratorError):
    def __init__(
        self,
        message: str = "Текст не схожий на звʼязний навчальний матеріал. Введіть осмислений текст без випадкового набору символів.",
    ):
        super().__init__("nonsense_input", message, status_code=400)


class LLMServerUnavailableError(GeneratorError):
    def __init__(
        self,
        message: str = "LLM-сервер (llama-server) не запущено або недоступний на порту 9931.",
    ):
        super().__init__("server_unavailable", message, status_code=503)


class LLMTimeoutError(GeneratorError):
    def __init__(
        self,
        message: str = "Час очікування відповіді від моделі вичерпано (таймаут).",
    ):
        super().__init__("timeout", message, status_code=504)


class LLMInvalidResponseError(GeneratorError):
    def __init__(
        self,
        message: str = "Модель повернула некоректну відповідь (невалідний JSON або порожній результат).",
    ):
        super().__init__("invalid_response", message, status_code=502)


class TranslationError(GeneratorError):
    def __init__(self, message: str = "Помилка перекладу тексту."):
        super().__init__("translation_error", message, status_code=502)


def clamp_max_tokens(max_tokens: int | None) -> int:
    """Гарантує обов'язковий ліміт токенів у безпечних межах."""
    if max_tokens is None:
        return DEFAULT_MAX_TOKENS
    return max(MIN_MAX_TOKENS, min(MAX_MAX_TOKENS, int(max_tokens)))


def count_words(text: str) -> int:
    return len(text.split()) if text.strip() else 0


VOWELS = set("аеєиіїоуюяёыэaeiouy")


def _is_gibberish_word(word: str) -> bool:
    """Перевіряє окреме слово (лише літери, lower) на ознаки випадкового набору клавіш."""
    if len(word) < 3:
        return False

    vowel_count = sum(1 for ch in word if ch in VOWELS)

    # 4+ літери без жодної голосної — майже завжди сміття або абревіатура
    if len(word) >= 4 and vowel_count == 0:
        return True

    # 5+ приголосних підряд (наприклад: рпрпв, asdfg)
    consonants_streak = 0
    for ch in word:
        if ch in VOWELS:
            consonants_streak = 0
        else:
            consonants_streak += 1
            if consonants_streak >= 5:
                return True

    # Довге слово з дуже малим різноманіттям літер (наприклад: іваріапрпіварва -> 5/15 = 0.33)
    if len(word) >= 9 and (len(set(word)) / len(word)) < 0.45:
        return True

    # Повторення одного символу 3+ рази підряд або блоку з 3+ літер (напр. asdfasdf)
    if re.search(r"(.)\1{2,}", word) or re.search(r"(.{3,})\1", word):
        return True

    return False


def validate_meaningful_text(text: str) -> None:
    """
    Захист від «дурника»: відсіює суцільний набір випадкових літер/символів,
    але пропускає нормальні навчальні тексти (навіть якщо там є хеш чи формули).
    """
    cleaned = text.strip()
    non_space = re.sub(r"\s+", "", cleaned)
    if len(non_space) < 15:
        raise InvalidInputTextError(
            "Текст занадто короткий. Введіть зв'язний навчальний матеріал (щонайменше кілька речень)."
        )

    tokens = re.findall(r"\S+", cleaned)
    if len(tokens) < 3:
        raise InvalidInputTextError(
            "Введіть зв'язний текст (щонайменше 3 слова), щоб модель могла створити картки."
        )

    # Частка літер серед непробільних символів
    alpha_chars = [ch.lower() for ch in non_space if ch.isalpha()]
    if len(alpha_chars) / len(non_space) < 0.45:
        raise InvalidInputTextError(
            "Текст має містити зв'язні слова, а не переважно цифри чи спецсимволи."
        )

    # Занадто бідний алфавіт для тексту (наприклад, тикання по 4-6 клавішах: іваріапрпіварва...)
    if len(alpha_chars) >= 25 and len(set(alpha_chars)) < 10:
        raise InvalidInputTextError(
            "Текст містить занадто мало різних літер і схожий на випадковий набір символів."
        )

    # Загальна частка голосних у літерах тексту
    total_vowels = sum(1 for ch in alpha_chars if ch in VOWELS)
    vowel_ratio = total_vowels / len(alpha_chars)
    if vowel_ratio < 0.18 or vowel_ratio > 0.72:
        raise InvalidInputTextError(
            "Текст виглядає як випадковий набір літер. Введіть осмислений навчальний текст."
        )

    # Виділяємо слова з літер (без пунктуації)
    alpha_words = [
        re.sub(r"[^a-zA-Zа-яА-ЯіїєґІЇЄҐёыэЁЫЭ]", "", t).lower() for t in tokens
    ]
    alpha_words = [w for w in alpha_words if w]

    if len(alpha_words) < 3:
        raise InvalidInputTextError(
            "Недостатньо слів для генерації карток. Введіть зв'язний текст."
        )

    # Перевірка на спам однакових слів
    if len(alpha_words) >= 6 and (len(set(alpha_words)) / len(alpha_words)) < 0.3:
        raise InvalidInputTextError(
            "Текст містить занадто багато повторів одного й того ж слова."
        )

    # Перевірка частки підозрілих («сміттєвих») слів
    checkable = [w for w in alpha_words if len(w) >= 3]
    if checkable:
        gibberish_count = sum(1 for w in checkable if _is_gibberish_word(w))
        if (gibberish_count / len(checkable)) >= 0.38:
            raise InvalidInputTextError()


def split_text_into_chunks(
    text: str,
    max_words: int = CHUNK_MAX_WORDS,
    max_chars: int = CHUNK_MAX_CHARS,
) -> list[str]:
    """
    Розбиває текст на невеликі пачки (по реченнях або словах),
    щоб і перекладач, і мала LLM стабільно обробляли кожну порцію.
    """
    cleaned = text.strip()
    if not cleaned:
        return []

    sentences = [
        s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", cleaned) if s.strip()
    ]
    chunks: list[str] = []
    current_parts: list[str] = []
    current_words = 0
    current_chars = 0

    def flush_current():
        nonlocal current_parts, current_words, current_chars
        if current_parts:
            chunks.append(" ".join(current_parts))
            current_parts = []
            current_words = 0
            current_chars = 0

    for sentence in sentences:
        s_words = count_words(sentence)
        s_chars = len(sentence)

        # Якщо одне речення перевищує ліміт пачки — розбиваємо по словах
        if s_words > max_words or s_chars > max_chars:
            flush_current()
            words = sentence.split()
            word_buf: list[str] = []
            char_len = 0
            for w in words:
                added_chars = len(w) + (1 if word_buf else 0)
                if word_buf and (
                    len(word_buf) + 1 > max_words or char_len + added_chars > max_chars
                ):
                    chunks.append(" ".join(word_buf))
                    word_buf = [w]
                    char_len = len(w)
                else:
                    word_buf.append(w)
                    char_len += added_chars
            if word_buf:
                chunks.append(" ".join(word_buf))
            continue

        added_chars = s_chars + (1 if current_parts else 0)
        if current_parts and (
            current_words + s_words > max_words
            or current_chars + added_chars > max_chars
        ):
            flush_current()

        current_parts.append(sentence)
        current_words += s_words
        current_chars += s_chars + (1 if len(current_parts) > 1 else 0)

    flush_current()
    return chunks


def check_llm_health() -> dict:
    """Перевіряє доступність llama-server та повертає активну модель."""
    try:
        resp = requests.get(MODELS_URL, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        model_id = data.get("data", [{}])[0].get("id")
        return {"llm_online": True, "model": model_id}
    except Exception:
        return {"llm_online": False, "model": None}


def _get_model_name() -> str:
    try:
        resp = requests.get(MODELS_URL, timeout=CONNECT_TIMEOUT_SECONDS)
        resp.raise_for_status()
        models_info = resp.json()
        model_name = models_info["data"][0]["id"]
        print(f"✅ Динамічно знайдено модель: {model_name}")
        return model_name
    except requests.ConnectionError as e:
        raise LLMServerUnavailableError() from e
    except requests.Timeout as e:
        raise LLMTimeoutError("Таймаут під час підключення до LLM-сервера.") from e
    except Exception as e:
        raise LLMServerUnavailableError(
            f"Не вдалося отримати список моделей від llama-server: {e}"
        ) from e


def _build_payload(
    model_name: str, english_text: str, max_tokens: int, stream: bool
) -> dict:
    system_prompt = (
        "You are an expert tutor. Create concise educational flashcards based ONLY on the provided text chunk. "
        "You must output STRICTLY a JSON array of objects. Each object must have 'question' and 'answer' string keys. "
        "Do not include any introductions, explanations, or markdown blocks outside the JSON."
    )
    return {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Text:\n{english_text}"},
        ],
        "temperature": 0.3,
        "max_tokens": clamp_max_tokens(max_tokens),
        "stream": stream,
    }


def _translate_single_mymemory(chunk: str, src: str, tgt: str) -> str:
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            time.sleep(0.4 + attempt * 1.2)
            return MyMemoryTranslator(source=src, target=tgt).translate(chunk)
        except Exception as e:
            last_err = e

    err_str = str(last_err) if last_err else ""
    if "too many requests" in err_str.lower() or "429" in err_str:
        raise TranslationError(
            "Сервіс MyMemory тимчасово обмежив запити. Зачекайте 10–15 секунд і спробуйте ще раз."
        )
    raise TranslationError(f"Помилка перекладу (MyMemory): {err_str}")


def _translate_text(text: str, direction: str) -> str:
    """
    Перекладає текст через безкоштовний MyMemoryTranslator з лімітом <= 450 символів
    на запит та паузою між запитами.
    """
    src, tgt = ("uk-UA", "en-US") if direction == "uk_to_en" else ("en-US", "uk-UA")
    cleaned = text.strip()
    if not cleaned:
        return ""

    if len(cleaned) <= 450:
        return _translate_single_mymemory(cleaned, src, tgt)

    # Якщо текст довший за 450 символів — розбиваємо на частини
    parts = split_text_into_chunks(cleaned, max_words=80, max_chars=450)
    translated_parts = [_translate_single_mymemory(p, src, tgt) for p in parts]
    return " ".join(translated_parts)


def _translate_cards_batch(items: list[tuple[str, str]]) -> list[dict]:
    """
    Перекладає питання та відповіді пачками до 450 символів через MyMemoryTranslator,
    щоб мінімізувати кількість запитів.
    """
    if not items:
        return []

    separator = "\n|||\n"
    result: list[dict] = []
    batch_pairs: list[tuple[str, str]] = []
    batch_len = 0

    def flush_batch(pairs: list[tuple[str, str]]):
        if not pairs:
            return
        flat: list[str] = []
        for q, a in pairs:
            flat.append(q.replace("|||", "/"))
            flat.append(a.replace("|||", "/"))
        joined = separator.join(flat)
        translated = _translate_single_mymemory(joined, "en-US", "uk-UA")
        parts = [p.strip() for p in translated.split("|||")]
        if len(parts) == len(flat):
            for i in range(0, len(parts), 2):
                if parts[i] and parts[i + 1]:
                    result.append({"question": parts[i], "answer": parts[i + 1]})
        else:
            # Якщо MyMemory з'їв розділювач — перекладаємо по одній картці
            for q, a in pairs:
                t_q = _translate_text(q, "en_to_uk")
                t_a = _translate_text(a, "en_to_uk")
                if t_q and t_a:
                    result.append({"question": t_q, "answer": t_a})

    for q, a in items:
        pair_len = len(q) + len(a) + len(separator) * 2
        if batch_pairs and batch_len + pair_len > 440:
            flush_batch(batch_pairs)
            batch_pairs = []
            batch_len = 0

        if pair_len > 440:
            t_q = _translate_text(q, "en_to_uk")
            t_a = _translate_text(a, "en_to_uk")
            if t_q and t_a:
                result.append({"question": t_q, "answer": t_a})
        else:
            batch_pairs.append((q, a))
            batch_len += pair_len

    flush_batch(batch_pairs)
    return result


def _parse_and_translate_cards(
    llm_output: str, finish_reason: str | None = None
) -> list[dict]:
    clean_text = (
        llm_output.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    if not clean_text:
        raise LLMInvalidResponseError("Модель повернула порожню відповідь.")

    try:
        cards_en = json.loads(clean_text)
    except json.JSONDecodeError as e:
        if finish_reason == "length":
            raise LLMInvalidResponseError(
                "Відповідь моделі обірвалася через ліміт токенів і не утворила валідний JSON. Спробуйте збільшити ліміт токенів."
            ) from e
        raise LLMInvalidResponseError(
            "Модель повернула некоректну відповідь (не вдалося розпарсити JSON)."
        ) from e

    if not isinstance(cards_en, list):
        raise LLMInvalidResponseError(
            "Модель повернула некоректну структуру (очікувався масив карток)."
        )

    valid_pairs: list[tuple[str, str]] = []
    for card in cards_en:
        if not isinstance(card, dict):
            continue
        eng_q = str(card.get("question", "")).strip()
        eng_a = str(card.get("answer", "")).strip()
        if eng_q and eng_a:
            valid_pairs.append((eng_q, eng_a))

    if not valid_pairs:
        raise LLMInvalidResponseError(
            "Модель не згенерувала жодної валідної картки з полями question/answer."
        )

    cards_uk = _translate_cards_batch(valid_pairs)
    if not cards_uk:
        raise LLMInvalidResponseError(
            "Не вдалося сформувати валідні картки після перекладу."
        )

    return cards_uk


def _validate_and_chunk(ukrainian_text: str) -> list[str]:
    words = count_words(ukrainian_text)
    if words == 0:
        raise GeneratorError(
            "empty_input", "Текст не може бути порожнім.", status_code=400
        )
    if words > MAX_INPUT_WORDS:
        raise InputTooLongError(words, MAX_INPUT_WORDS)
    validate_meaningful_text(ukrainian_text)
    return split_text_into_chunks(ukrainian_text)


def generate_flashcards_pipeline(
    ukrainian_text: str, max_tokens: int = DEFAULT_MAX_TOKENS
) -> list[dict]:
    effective_max_tokens = clamp_max_tokens(max_tokens)
    chunks = _validate_and_chunk(ukrainian_text)
    model_name = _get_model_name()

    all_cards: list[dict] = []

    for idx, chunk in enumerate(chunks, start=1):
        english_text = _translate_text(chunk, "uk_to_en")

        payload = _build_payload(
            model_name=model_name,
            english_text=english_text,
            max_tokens=effective_max_tokens,
            stream=False,
        )

        try:
            response = requests.post(
                LLM_URL,
                json=payload,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )
        except requests.ConnectionError as e:
            raise LLMServerUnavailableError() from e
        except requests.Timeout as e:
            raise LLMTimeoutError() from e
        except requests.RequestException as e:
            raise LLMServerUnavailableError(
                f"Помилка мережі при зверненні до LLM: {e}"
            ) from e

        if response.status_code != 200:
            raise LLMInvalidResponseError(
                f"LLM-сервер повернув помилку (код {response.status_code}) на пачці {idx}/{len(chunks)}."
            )

        try:
            resp_json = response.json()
            choice = resp_json["choices"][0]
            llm_output = choice["message"]["content"]
            finish_reason = choice.get("finish_reason")
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMInvalidResponseError(
                "LLM-сервер повернув відповідь у несподіваному форматі."
            ) from e

        chunk_cards = _parse_and_translate_cards(
            llm_output, finish_reason=finish_reason
        )
        all_cards.extend(chunk_cards)

    return all_cards


def generate_flashcards_stream(
    ukrainian_text: str, max_tokens: int = DEFAULT_MAX_TOKENS
) -> Generator[dict, None, None]:
    """Потоково генерує картки пачками та віддає події прогресу й токенів."""
    effective_max_tokens = clamp_max_tokens(max_tokens)
    chunks = _validate_and_chunk(ukrainian_text)
    total_chunks = len(chunks)

    yield {
        "type": "status",
        "stage": "connecting",
        "message": f"Підключення до LLM-сервера (пачок для обробки: {total_chunks})...",
        "total_chunks": total_chunks,
    }
    model_name = _get_model_name()

    all_cards: list[dict] = []
    any_truncated = False

    for idx, chunk in enumerate(chunks, start=1):
        batch_prefix = f"Пачка {idx}/{total_chunks}: " if total_chunks > 1 else ""

        yield {
            "type": "status",
            "stage": "translating_in",
            "message": f"{batch_prefix}переклад тексту на англійську...",
            "chunk_index": idx,
            "total_chunks": total_chunks,
        }
        english_text = _translate_text(chunk, "uk_to_en")

        yield {
            "type": "status",
            "stage": "generating",
            "message": f"{batch_prefix}генерація моделлю {model_name} (ліміт: {effective_max_tokens} токенів)...",
            "model": model_name,
            "max_tokens": effective_max_tokens,
            "chunk_index": idx,
            "total_chunks": total_chunks,
        }

        if total_chunks > 1:
            yield {
                "type": "token",
                "content": f"\n--- Пачка {idx}/{total_chunks} ---\n",
            }

        payload = _build_payload(
            model_name=model_name,
            english_text=english_text,
            max_tokens=effective_max_tokens,
            stream=True,
        )

        token_chunks: list[str] = []
        finish_reason: str | None = None

        try:
            with requests.post(
                LLM_URL,
                json=payload,
                stream=True,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            ) as response:
                if response.status_code != 200:
                    raise LLMInvalidResponseError(
                        f"{batch_prefix}LLM-сервер повернув помилку (код {response.status_code})."
                    )

                for raw_line in response.iter_lines(decode_unicode=True):
                    if not raw_line or not raw_line.startswith("data:"):
                        continue
                    data_str = raw_line[len("data:") :].strip()
                    if data_str == "[DONE]":
                        break

                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    if choice.get("finish_reason"):
                        finish_reason = choice.get("finish_reason")

                    delta = choice.get("delta") or {}
                    token_text = delta.get("content")
                    if token_text:
                        token_chunks.append(token_text)
                        yield {"type": "token", "content": token_text}
        except requests.ConnectionError as e:
            raise LLMServerUnavailableError() from e
        except requests.Timeout as e:
            raise LLMTimeoutError() from e
        except GeneratorError:
            raise
        except requests.RequestException as e:
            raise LLMServerUnavailableError(
                f"Помилка мережі при зверненні до LLM: {e}"
            ) from e

        if finish_reason == "length":
            any_truncated = True

        full_output = "".join(token_chunks)

        yield {
            "type": "status",
            "stage": "parsing",
            "message": f"{batch_prefix}перевірка JSON та переклад карток українською...",
            "chunk_index": idx,
            "total_chunks": total_chunks,
        }

        chunk_cards = _parse_and_translate_cards(
            full_output, finish_reason=finish_reason
        )
        all_cards.extend(chunk_cards)

    yield {
        "type": "cards",
        "cards": all_cards,
        "truncated": any_truncated,
    }
