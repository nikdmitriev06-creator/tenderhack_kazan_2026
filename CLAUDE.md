# TenderHack Казань 2026 — карта проекта и правила хакатона

Хакатон 09–11.10.2026 (разработка 21:00 09.10 — 13:00 11.10), кейс «Автозаполнение ключевых характеристик в СТЕ».
ТЗ и разбор — `docs/tz/`, ресерч — `docs/research/`, план подготовки — `docs/plans/2026-09-30-llm-data-glossary.md`.
Сначала читать их, а не код.

## Правила хакатона (решения пользователя, 30.09.2026)

- **LLM только через API, под два бэкенда сразу.** Локальный Ollama (сейчас) и наша «ручка» на арендованном
  GPU-сервере (OpenAI-совместимый API: vLLM, llama.cpp server или Ollama `/v1`). Сервер дорогой, его берём ближе к
  делу, поэтому всё должно работать и проверяться локально. Переключение — только `.env` (`LLM_PROVIDER`,
  `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_CHAT_MODEL`; эмбеддинги отдельно — `EMBED_*`). Код бэкенд-зависимым не делать.
- **Внешние облачные API запрещены** (во всех прошлых методичках организатора; в Перми и Москве мы это нарушили —
  облако NVIDIA). Модели лёгкие, выбор обосновываем замером.
- **Модель проверяется руками до того, как ей доверяем**: `uv run python -m app.tools.llm_smoke` против текущего
  `.env` (русский ответ, извлечение в JSON, аббревиатуры, эмбеддинги). Новую модель или сервер — сначала им.
  Рассуждения выключены (`LLM_THINK=false`): у qwen3.5:9b они дают 3 с вместо 0,35 с на коротком вопросе.
- **Правила вывода LLM исполняет код**: ответ со схемой валидируется pydantic (`LLMOutputError` иначе), значения и
  единицы принимаются, только если есть в справочнике (КТРУ/ОКЕИ). Промпт — не гарантия.
- **Формат данных организаторов заранее неизвестен.** Первое действие на старте — `uv run python -m
  app.tools.recon <что дали>`: роли колонок угадываются по содержимому, архивы распаковываются сами. Под
  неожиданный формат дописываем читатель в `app/ingest/readers.py` и тест с примером файла.
- **Эксперты говорят аббревиатурами.** Наш словарь — `backend/app/glossary/abbreviations.csv`; из их базы —
  `uv run python -m app.tools.mine_abbreviations <данные> --to-db` в таблицу `glossary_abbreviation`
  (`source`: seed / mined / manual). В промпт LLM идёт `Glossary.prompt_block(text)`, в эмбеддинги — `expand`.
- **Данные организаторов — только в `data/`** (в `.gitignore`), не коммитить и не отправлять во внешние сервисы
  (п. 6.17). Данные прошлых хакатонов — `data/past/<город>/` (скачивает `data/past/fetch.py`), там же отчёты recon.
- **Риск п. 7.5** (проект целиком создаётся на хакатоне, у топ-5 код-ревью): подготовку делаем заранее по решению
  пользователя; помнить, что история коммитов видна.
- Когда пользователь просит «потыкать» или «посмотреть глазами» — поднять решение и смотреть скриншотами через
  расширение Chrome. 30.09 подключённый к расширению браузер не видел localhost этого ПК — тогда сказать об этом.

## Карта кода

| Путь | Что |
|---|---|
| `backend/app/main.py` | FastAPI-приложение, lifespan создаёт `Resources` |
| `backend/app/resources.py` | подключения: SQLAlchemy, Redis, RabbitBroker (лениво, объявляет durable-очереди), `LLMClient` |
| `backend/app/llm/` | `LLMClient`: `chat(messages, schema=)`, `embed`, `missing_models`; провайдеры `ollama` и `openai` (`providers.py`), повторы и разбор ответа (`base.py`) |
| `backend/app/ingest/readers.py` | чтение папки/zip/7z/xlsx/csv (кодировка, разделитель, таблицы без заголовка)/json/jsonl |
| `backend/app/ingest/characteristics.py` | разбор характеристик любых форматов: числа, диапазоны, единицы из имени и значения |
| `backend/app/ingest/profile.py` | роли колонок по содержимому, статистика характеристик |
| `backend/app/ingest/units.py` | словарь единиц → канон |
| `backend/app/glossary/` | словарь аббревиатур: `Glossary` (`expand`, `find`, `prompt_block`), `mine` |
| `backend/app/tools/` | `recon`, `mine_abbreviations`, `llm_smoke` |
| `backend/app/health.py` | проверки готовности (postgres, redis, rabbitmq, llm) |
| `backend/app/api/` | `GET /api/health`, `/api/health/ready`, `POST /api/jobs/ping`, `GET /api/jobs/{id}` |
| `backend/app/worker.py` | воркер FastStream |
| `backend/migrations/` | Alembic: pgvector, `glossary_abbreviation` |
| `backend/scripts/make_fake_dataset.py` | фейковый датасет → `backend/tests/fixtures/fake/` (СТЕ в 4 форматах, КТРУ в 2, `ground_truth.json`) |
| `frontend/src/App.tsx` | страница состояния системы (заглушка до хакатона) |
| `docker-compose.yml` | проект `tenderhack-kazan`; postgres, redis, rabbitmq, ollama (профиль `llm`), migrate, api, worker, web |

Порты: web 8080, api 8000, postgres 5432, redis 6379, rabbitmq 5672/15672, ollama 11434 (меняются в `.env`).
Из контейнеров Ollama хоста виден как `host.docker.internal:11434`.

## Команды

- Всё целиком: `docker compose up -d --build`; Ollama в контейнере — `--profile llm`, GPU — `-f compose.gpu.yaml`.
- Бэкенд: `cd backend && uv run pytest && uv run ruff check .`
- Фронт: `cd frontend && npm run build && npm run lint`
- Секреты — только в `.env`; `.env.example` без реальных паролей.
