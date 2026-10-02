# TenderHack Казань 2026 — автозаполнение характеристик СТЕ

Кейс «Автозаполнение ключевых характеристик в СТЕ» для Портала поставщиков (zakupki.mos.ru). Решение — модуль,
который портал встраивает в форму «Создание СТЕ» через API: по наименованию и описанию товара он подбирает позицию
КТРУ, заполняет характеристики из справочника, приводит значения и единицы к единому виду, по шагам сужает выбор до
конечного кода и объясняет каждое найденное нарушение правил модерации. Решение по каждому полю остаётся за человеком.

Сейчас модуль работает на демо-справочнике (`backend/app/catalog/demo/demo.json`, синтетика с именами характеристик
портала; генератор `make_demo.py` рядом).
Справочник организаторов подключается переменной `CATALOG_PATHS`; под его формат пишется загрузчик в
`backend/app/catalog/loaders.py`, контракт API не меняется.

## Документы

- [docs/tz/](docs/tz/README.md) — ТЗ дословно (страница кейса, Положение) и наш разбор: чек-лист, ограничения,
  вопросы организаторам, метрики.
- [docs/plans/2026-10-01-portal-module-design.md](docs/plans/2026-10-01-portal-module-design.md) — дизайн модуля:
  контракт API, экраны, конвейер, сбои.
- [docs/demo-scenarios.md](docs/demo-scenarios.md) — сценарии показа.
- [docs/bpmn/](docs/bpmn/) — BPMN 2.0 процесса (`module.bpmn` открывается в bpmn.io и Camunda Modeler) и картинка.
- [docs/research/](docs/research/) — как TenderHack ставит задачи и оценивает, что не так на zakupki.mos.ru.

## Запуск

```bash
cp .env.example .env          # модель, справочник, порты
docker compose up -d --build
docker compose exec api python -m app.tools.evaluate   # метрики на золотом наборе для страницы «Метрики»
```

| Что | Адрес |
|---|---|
| Образец экранов портала: создание СТЕ, массовая загрузка, заявки, метрики, API | http://localhost:8080 |
| Контракт API (Swagger, OpenAPI) | http://localhost:8080/api/docs, `/api/openapi.json` |
| Готовность зависимостей | http://localhost:8080/api/health/ready |
| RabbitMQ UI (tenderhack / tenderhack) | http://localhost:15672 |

Модели — только через наш API, внешние облачные API в итоговой сборке запрещены. Бэкенд выбирается в `.env`:
локальный Ollama (`LLM_PROVIDER=ollama`) или наш GPU-сервер с OpenAI-совместимым API (`LLM_PROVIDER=openai`,
`LLM_BASE_URL=http://<сервер>:8000/v1`). Эмбеддинги можно брать отдельно (`EMBED_*`); без них поиск идёт по BM25,
а ответ помечается `degraded: ["embeddings"]`. Без LLM характеристики извлекаются правилами (`degraded: ["llm"]`).

```bash
ollama pull qwen3:4b && ollama pull bge-m3                    # Ollama на хосте (из контейнеров — host.docker.internal)
docker compose exec api python -m app.tools.index_catalog     # векторный индекс справочника (нужна модель эмбеддингов)
cd backend && uv run python -m app.tools.llm_smoke            # ручная проверка модели против текущего .env
```

## API модуля

| Метод | Что делает |
|---|---|
| `POST /api/v1/autofill` | наименование и описание → кандидаты КТРУ, характеристики с фрагментом текста, замечания, вопрос |
| `POST /api/v1/autofill/{session_id}/answer` | ответ на уточняющий вопрос → сужение до кода или шаги |
| `POST /api/v1/check` | готовая карточка → замечания с обоснованием и ссылкой на правило модерации |
| `GET /api/v1/ktru/{code}` | позиция справочника |
| `POST /api/v1/batch`, `GET /api/v1/batch/{id}`, `…/result.xlsx` | массовая загрузка через очередь |
| `GET /api/v1/metrics` | качество на золотом наборе |

Стенд портала для показа (не часть модуля): очередь заявок модератора `/api/demo/submissions`.

## Инструменты

```bash
cd backend
uv run python -m app.tools.recon <что дали организаторы>        # формат, колонки, роли, характеристики
uv run python -m app.tools.mine_abbreviations <данные> --to-db  # аббревиатуры из их базы в таблицу
uv run python -m app.tools.evaluate [--llm]                     # золотой набор, метрики, калибровка порога
uv run python -m app.tools.export_openapi                       # контракт для фронта, затем npm run gen:api
uv run python -m scripts.bpmn                                   # BPMN и SVG из кода
uv run python scripts/make_fake_dataset.py                      # фейковый датасет для тестов
```

## Разработка

Бэкенд (Python 3.12, uv):

```bash
docker compose up -d postgres redis rabbitmq migrate   # инфраструктура
cd backend
uv sync
uv run uvicorn app.main:app --reload     # API на :8000 (без CATALOG_PATHS — демо-справочник)
uv run faststream run app.worker:app     # воркер очереди
uv run pytest
uv run ruff check . && uv run ruff format .
```

Фронтенд (React 19 + Vite + TypeScript + Tailwind 4):

```bash
cd frontend
npm ci
npm run dev      # http://localhost:5173, /api проксируется на :8000 (VITE_API_PROXY)
npm test && npm run build && npm run lint
playwright-cli open http://localhost:8080/ && playwright-cli --raw run-code --filename=e2e/flows.js   # сквозные сценарии
```

## Структура

```
backend/app/catalog     справочник позиций: модель, загрузчики JSON/CSV, каталог в памяти
backend/app/values.py   значение против перечня: корзины, диапазоны, единицы, опечатки
backend/app/checks      правила модерации портала (перенос и сверка с прототипом) и детектор ошибок карточки
backend/app/search      кандидаты: BM25 + эмбеддинги (pgvector), RRF, отсечка «вне справочника»
backend/app/extract     извлечение характеристик: правила, затем LLM с проверкой ответа кодом
backend/app/narrowing.py сужение до кода и уточняющие вопросы; app/session.py — сессия в Redis
backend/app/pipeline.py конвейер /autofill; app/batch.py — массовая загрузка; app/demo — заявки стенда
backend/app/evaluation  золотой набор и метрики
frontend/src/pages      экраны: create, batch, moderation, metrics, developers
docs/                   ТЗ, дизайн, BPMN, ресерч
```

## Правила, которые влияют на код

- Данные организаторов не коммитим: `data/` в `.gitignore` (п. 6.17 Положения).
- Значение и единица попадают в ответ, только если они есть в справочнике позиции и в ОКЕИ; это проверяет код.
- Внешние API, в том числе LLM, в итоговой сборке запрещены: только свои модели, и лёгкие.
- Секреты — только в `.env`.
