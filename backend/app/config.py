from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["ollama", "openai"]
# Рассуждения: False — выключить, None — не передавать, уровень — для моделей, которые
# не выключают их совсем (gpt-oss: с low ~15 символов рассуждения вместо ~900, замер 01.10.2026).
Think = bool | Literal["low", "medium", "high"] | None

# Демо-справочник в репозитории: синтетика с именами характеристик портала (app/catalog/demo).
DEMO_CATALOG = Path(__file__).parent / "catalog" / "demo" / "demo.json"


class Settings(BaseSettings):
    """Настройки из переменных окружения (в docker compose их задаёт compose-файл).

    Значения по умолчанию подходят для локального запуска против инфраструктуры из compose.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://tenderhack:tenderhack@localhost:5432/tenderhack"
    redis_url: str = "redis://localhost:6379/0"
    rabbitmq_url: str = "amqp://tenderhack:tenderhack@localhost:5672/"

    # LLM: ollama — нативный API Ollama; openai — любой OpenAI-совместимый сервер (vLLM, llama.cpp,
    # Ollama /v1) на нашем GPU-сервере. Внешние облачные API по правилам хакатона запрещены.
    llm_provider: Provider = "ollama"
    llm_base_url: str = "http://localhost:11434"
    llm_api_key: str = ""
    llm_chat_model: str = "qwen3:4b"
    llm_timeout_s: float = 120.0
    llm_max_retries: int = 2
    # Рассуждения (think) у qwen3/qwen3.5 по умолчанию включены и замедляют ответ в разы
    # (замер 30.09: 0,35 с против 3 с на коротком вопросе). None — не передавать параметр.
    llm_think: Think = False
    # Ollama и сервер могут быть недоступны при разработке: readiness без них не падает.
    llm_required: bool = False

    # Эмбеддинги можно брать у другого провайдера; пустые значения = как у LLM.
    embed_provider: Provider | None = None
    embed_base_url: str = ""
    embed_api_key: str = ""
    embed_model: str = "bge-m3"

    health_timeout_s: float = 2.0
    job_ttl_s: int = 3600

    # Файлы справочника через запятую (.json или .csv), пути от рабочего каталога процесса.
    # Пусто — демо-справочник из репозитория (app/catalog/demo/demo.json, синтетика): чистый клон
    # стартует сам. Справочник организаторов кладут в ./data и указывают здесь.
    catalog_paths: str = ""

    # Отсечка «товар вне справочника»: нормированная оценка BM25 лучшего кандидата (0..1).
    # Калибруется скриптом оценки на золотом наборе (app.tools.evaluate).
    search_min_score: float = 0.2
    # Результат последнего прогона оценки: его отдаёт GET /api/v1/metrics.
    metrics_path: str = "data/metrics/latest.json"
    # Отчёт по живым карточкам портала (app.tools.portal_report): GET /api/v1/metrics/portal.
    portal_report_path: str = "data/metrics/portal.json"
    # Кэш ответов модели в Redis (тот же текст — без второго вызова LLM), секунды; 0 — выключен.
    llm_cache_ttl_s: int = 86400

    def catalog_files(self) -> list[Path]:
        files = [Path(p.strip()) for p in self.catalog_paths.split(",") if p.strip()]
        return files or [DEMO_CATALOG]

    @field_validator("embed_provider", mode="before")
    @classmethod
    def _empty_is_none(cls, value: object) -> object:
        return value or None  # EMBED_PROVIDER= в .env значит «как у LLM»


@lru_cache
def get_settings() -> Settings:
    return Settings()
