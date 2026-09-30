# TenderHack Казань 2026 — автозаполнение характеристик СТЕ

Кейс «Автозаполнение ключевых характеристик в СТЕ» для Портала поставщиков (zakupki.mos.ru): по описанию товара
подобрать характеристики из справочника КТРУ, привести значения и единицы к единому виду, по шагам сузить категорию
до конечного кода КТРУ и объяснить найденные ошибки. Хакатон 09–11.10.2026, Казань.

Сейчас в репозитории ТЗ, ресерч и общий каркас: инфраструктура, health-проверки, сборка. Доменную логику пишем на
хакатоне (п. 7.5 Положения: проект создаётся на месте).

## Документы

- [docs/tz/](docs/tz/README.md) — ТЗ дословно (страница кейса, Положение) и наш разбор: чек-лист, ограничения,
  вопросы организаторам, метрики.
- [docs/research/](docs/research/) — как TenderHack ставит задачи и оценивает, что не так на zakupki.mos.ru,
  наши прошлые TenderHack.

## Запуск

```bash
cp .env.example .env          # необязательно: без .env работают значения по умолчанию
docker compose up -d --build
```

| Что | Адрес |
|---|---|
| Веб-интерфейс (пока — страница состояния) | http://localhost:8080 |
| API и Swagger | http://localhost:8000/docs |
| Готовность зависимостей | http://localhost:8000/api/health/ready |
| RabbitMQ UI (tenderhack / tenderhack) | http://localhost:15672 |

Модели — только через наш API, внешние облачные API запрещены. Бэкенд выбирается в `.env`:
локальный Ollama (`LLM_PROVIDER=ollama`) или наш GPU-сервер с OpenAI-совместимым API (`LLM_PROVIDER=openai`,
`LLM_BASE_URL=http://<сервер>:8000/v1`). Эмбеддинги можно брать отдельно (`EMBED_*`).

```bash
ollama pull qwen3:4b && ollama pull bge-m3          # Ollama на хосте (из контейнеров — host.docker.internal)
docker compose --profile llm up -d ollama           # или Ollama в контейнере; GPU: -f compose.gpu.yaml
cd backend && uv run python -m app.tools.llm_smoke  # ручная проверка модели против текущего .env
```

## Инструменты на старте хакатона

```bash
cd backend
uv run python -m app.tools.recon <что дали организаторы>               # формат, колонки, роли, характеристики
uv run python -m app.tools.mine_abbreviations <данные> --to-db         # аббревиатуры из их базы в таблицу
uv run python scripts/make_fake_dataset.py                             # пересобрать фейковый датасет для тестов
```

## Разработка

Бэкенд (Python 3.12, uv):

```bash
docker compose up -d postgres redis rabbitmq migrate   # инфраструктура
cd backend
uv sync
uv run uvicorn app.main:app --reload     # API на :8000
uv run faststream run app.worker:app     # воркер очереди
uv run pytest
uv run ruff check . && uv run ruff format .
uv run alembic revision -m "..."         # новая миграция
```

Фронтенд (React 19 + Vite + TypeScript + Tailwind 4):

```bash
cd frontend
npm ci
npm run dev      # http://localhost:5173, /api проксируется на :8000
npm run build && npm run lint
```

## Структура

```
backend/            FastAPI (app/main.py) + воркер FastStream (app/worker.py), Alembic-миграции
frontend/           SPA на React, в Docker раздаётся nginx с прокси /api
docs/tz/            ТЗ и разбор
docs/research/      ресерч
docker-compose.yml  postgres (pgvector), redis, rabbitmq, ollama (профиль llm), migrate, api, worker, web
compose.gpu.yaml    GPU для Ollama
```

## Правила, которые влияют на код

- Данные организаторов не коммитим: `data/` в `.gitignore` (п. 6.17 Положения).
- Внешние API, в том числе LLM, во всех прошлых методичках запрещены: только локальные модели, и лёгкие.
- Секреты — только в `.env`.
