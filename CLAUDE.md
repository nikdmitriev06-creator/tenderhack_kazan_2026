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
  С 01.10.2026 для разработки до хакатона — Ollama Cloud, `gpt-oss:120b` с `LLM_THINK=low` (`.env.example`, вариант 3): из бесплатных лучшая по замеру, флагманы платные (402).
  Эмбеддингов в облаке нет (`/api/embed` → 401), проверка готовности показывает их отдельной строкой `embeddings`.
  На хакатоне облако выключить: `LLM_BASE_URL` на свой сервер или локальный Ollama.
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
  Пермских данных на диске нет, папка Google Drive со страницы tenderhack.ru/perm анонимно пустая (01.10.2026).
- **Датасет с портала** — `data/portal/` (01.10.2026, публичный API zakupki.mos.ru вне закрытого robots.txt `/api`):
  `skus.jsonl` 2 549 СТЕ из 43 областей с характеристиками, `skus_detailed.jsonl` 430 полных карточек, `stats.md`
  выводы. Скрипты `fetch_portal.py`, `fetch_details.py` (последовательно, пауза 0,8 с). В карточках портала нет КТРУ
  (0 из 430), описание есть у 7 %: вход «свободный текст» = наименование + описание.
  02.10.2026 `fetch_categories.py` докачал `categories.jsonl`: 6 329 СТЕ из 35 плотных категорий (бумага, батарейки,
  перчатки смотровые, картриджи по 300, ещё 25 самых наполненных по 200). Мешков для мусора отдельной категорией в
  дереве нет. Отчёт по ним — `uv run python -m app.tools.portal_report ../data/portal/skus.jsonl
  ../data/portal/categories.jsonl --out ../data/metrics/portal.json --catalog ../data/catalog/portal.json` (из
  `backend/`, ~2,5 мин): аудит модерации, заполнение против портала, справочник из 39 категорий (`CATALOG_PATHS`).
- **Риск п. 7.5** (проект целиком создаётся на хакатоне, у топ-5 код-ревью): подготовку делаем заранее по решению
  пользователя; помнить, что история коммитов видна.
- Когда пользователь просит «потыкать» или «посмотреть глазами» — поднять решение и смотреть скриншотами через
  расширение Chrome. Вечером 30.09 localhost:8080 открылся. Скриншот первые разы падал по таймауту, при этом
  `find`, `get_page_text`, клики по `ref` и `read_network_requests` работали, а после переподключения расширения
  заработал и скриншот. Если браузер localhost не видит — сказать об этом.

## Карта кода

| Путь | Что |
|---|---|
| `backend/app/main.py` | FastAPI-приложение (`/api/docs`, `/api/openapi.json`), lifespan создаёт `Resources`, `app.state.deps` и репозиторий заявок |
| `backend/app/resources.py` | подключения: SQLAlchemy, Redis, RabbitBroker (лениво, объявляет durable-очереди), `LLMClient`, `Catalog`; `build_deps` собирает `Deps` конвейера (API и воркер) |
| `backend/app/catalog/` | справочник позиций: `Position`/`CharacteristicSpec`, загрузчики JSON и длинного CSV, `Catalog.load(CATALOG_PATHS)`; под формат организаторов — новый загрузчик |
| `backend/app/values.py` | `fit_value(значение, единица, спецификация)`: перечень, корзины «>=80 … <90», диапазон, пересчёт единиц, опечатки (`nearest_allowed`), латинские двойники (`fold`) |
| `backend/app/checks/` | `moderation.py` — правила модерации портала, перенос `prototype/rules.ts` со сверкой на 13 тыс. вызовов (`tests/fixtures/rules_golden.json.gz`); `detector.py` — замечания карточки против позиции |
| `backend/app/search/` | кандидаты: BM25 (`snowballstemmer`, опечатка запроса → ближайшее слово словаря `BM25Index.correct`), эмбеддинги в pgvector (`catalog_embedding`), RRF, порог «вне справочника» по наименованию, кандидат только при совпадении слова с наименованием позиции, отрицания «не/без» исключают позиции |
| `backend/app/extract/` | извлечение: правила (фразы описания по строкам, «;», точкам и запятым; «метка значение», «метка: значение», числа и составные единицы «80 г/м2» из наименования, значения перечня), затем LLM; ответ LLM проверяет код (цитата есть в тексте и содержит значение). Значения от LLM код КТРУ не выбирают |
| `backend/app/narrowing.py`, `session.py` | сужение до кода, вопрос с вариантами «нет такой характеристики» (`""`) и «Ничего не подходит» (`__nothing__`), вопрос «Позиция КТРУ» — подтвердить позицию, если в наименовании есть незнакомые слова; сессия в Redis, ответы — полями хэша |
| `backend/app/pipeline.py`, `schemas.py` | конвейер `/autofill`, `/answer`, `/check`; модели API — единственный источник формы ответа |
| `backend/app/batch.py` | массовая загрузка: разбор файла, строки через очередь `jobs.batch`, xlsx с результатом; статусы строк `ready`, `needs_answer`, `needs_fix`, `not_found` (причина в «Замечаниях»), `skipped`, `failed` |
| `backend/app/demo/` | заявки стенда портала (`submission`), `/api/demo` |
| `backend/app/evaluation/` | золотой набор (чистые, опечатки, вне справочника, порча для детектора) и метрики |
| `backend/app/portal/` | живые карточки портала: `load_cards`, `ValueIndex` (значения по категориям, склейка вариантов написания, перечень без самой карточки), `compare_card`/`fill_rows` (заполнение против поставщика), `audit` (правила модерации и ошибки ввода `input_slip`), `build_positions` (справочник КПГЗ), `build_report` → `GET /api/v1/metrics/portal` |
| `backend/app/llm/` | `LLMClient`: `chat(messages, schema=)`, `embed`, `missing_models`; провайдеры `ollama` и `openai` (`providers.py`), повторы и разбор ответа (`base.py`); `CachedChat` (`cache.py`) — кэш ответов в Redis, `LLM_CACHE_TTL_S` (0 — выключен) |
| `backend/app/ingest/readers.py` | чтение папки/zip/7z/xlsx/csv (кодировка, разделитель, таблицы без заголовка)/json/jsonl |
| `backend/app/ingest/characteristics.py` | разбор характеристик любых форматов: числа, диапазоны, единицы из имени и значения |
| `backend/app/ingest/profile.py` | роли колонок по содержимому, статистика характеристик |
| `backend/app/ingest/units.py` | словарь единиц → канон |
| `backend/app/glossary/` | словарь аббревиатур: `Glossary` (`expand`, `find`, `prompt_block`), `mine` |
| `backend/app/tools/` | `recon`, `mine_abbreviations`, `llm_smoke`, `evaluate` (метрики и порог), `portal_report` (живые карточки портала), `index_catalog` (векторы), `export_openapi` (контракт для фронта) |
| `backend/app/health.py` | проверки готовности (postgres, redis, rabbitmq, llm) |
| `backend/app/api/` | `v1.py` — контракт модуля `/api/v1`; `demo.py` — `/api/demo/submissions`; служебные `/api/health*`, `/api/jobs/*` |
| `backend/app/worker.py` | воркер FastStream: `jobs.ping`, `jobs.batch` (тот же конвейер через `build_deps`) |
| `backend/migrations/` | Alembic: pgvector, `glossary_abbreviation`, `catalog_embedding`, `submission` |
| `backend/scripts/make_fake_dataset.py` | фейковый датасет → `backend/tests/fixtures/fake/` (СТЕ в 4 форматах, КТРУ в 2, `ground_truth.json`) |
| `backend/scripts/bpmn.py` | BPMN 2.0 с DI и SVG из кода → `docs/bpmn/`, `frontend/public/bpmn/` |
| `backend/app/catalog/demo/` | `demo.json` — демо-справочник по умолчанию (синтетика с именами характеристик портала, генератор `make_demo.py`); `data/catalog/portal_filters_paper.md` (вне git) — фильтры каталога портала |
| `DESIGN.md` | дизайн-система текущих экранов (метафора корректуры, Onest / PT Serif / JetBrains Mono). 02.10.2026 пользователь назвал её устаревшей и выбрал новое направление: прототип `/preview` |
| `frontend/src/preview/` | **новый дизайн** (выбран 02.10.2026): MUI, модуль заполняет саму форму карточки вместо отчёта; переключатель «Поставщик / Модератор», у модератора та же карточка только для чтения. Пока на данных примера (`sample.ts`), экраны `src/pages` ещё не переведены. MUI с Tailwind v4: порядок слоёв — `GlobalStyles` первым ребёнком `StyledEngineProvider enableCssLayer` |
| `frontend/src/index.css` | токены Tailwind v4 (`@theme`): `canvas`, `surface`, `raised`, `line`, `ink`, `muted`, `subtle`, `mark`, `pencil`, тона статусов, `--radius-ui/panel`; `.marker` — маркер с прокраской, `.rise` — появление по очереди |
| `frontend/src/ui/` | компоненты: `Button`, `Field`/`Input`/`Select`/`Textarea`, `Radio`/`Checkbox`, `Tabs`, `Badge`/`Notice`/`Skeleton`/`EmptyState`, `Panel`, `Table`/`DefinitionList`/`Steps`, `Dialog` |
| `frontend/src/layout/` | `AppHeader` (название модуля, переключатель роли «Поставщик / Модератор» и разделы роли, справа «Метрики · API»), `PageHeader`, `PageBody` |
| `frontend/src/pages/` | `/` создание СТЕ (`create/`: `createModel.ts` — решения по строкам, `mergeRows` после ответа, в карточку только принятые; `ktruView.ts` — подписи вопроса, «Ничего не подходит», «Подтвердите позицию КТРУ»), `/batch`, `/moderation`, `/metrics`, `/developers`; `/ui` — витрина компонентов, `/preview` — прототип нового дизайна (оба вне навигации) |
| `frontend/src/api/` | `v1.ts` — клиент `api`; типы из `schema.d.ts` (`npm run gen:api` по `openapi.json`); `http.ts` — `ApiError` с `detail` |
| `frontend/e2e/flows.js` | сквозные сценарии на :8080 (`playwright-cli --raw run-code --filename=e2e/flows.js`) |
| `frontend/src/App.tsx`, `routes.ts`, `lib/` | таблица маршрутов (`resolveRoute`, `NAV_GROUPS`), переходы без библиотеки (`router.ts`), форматы (`format.ts`) |
| `docker-compose.yml` | проект `tenderhack-kazan`; postgres, redis, rabbitmq, ollama (профиль `llm`), migrate, api, worker, web |

Порты: web 8080, api 8000, postgres 5432, redis 6379, rabbitmq 5672/15672, ollama 11434 (меняются в `.env`).
Из контейнеров Ollama хоста виден как `host.docker.internal:11434`.

## Команды

- Всё целиком: `docker compose up -d --build`; Ollama в контейнере — `--profile llm`, GPU — `-f compose.gpu.yaml`.
- Бэкенд: `cd backend && uv run pytest && uv run ruff check .`
- Фронт: `cd frontend && npm test && npm run build && npm run lint`
- Контракт изменился: `uv run python -m app.tools.export_openapi`, затем `npm run gen:api` (тест `test_openapi_snapshot_is_current` ловит забытое)
- Метрики: `docker compose exec api python -m app.tools.evaluate`; BPMN: `uv run python -m scripts.bpmn`
- После правки поиска, извлечения или сужения — `cd backend && uv run python -m app.tools.evaluate`: юнит-тесты не ловят
  ложные совпадения на товарах вне справочника (исправление опечаток «колёс» → «солев» нашла только оценка, порог уехал с 0,2)
- Решения по ходу реализации модуля (57 строк «Ruling» с ценой ошибки) — `docs/plans/2026-10-01-portal-module-ledger.md`
- Секреты — только в `.env`; `.env.example` без реальных паролей.
