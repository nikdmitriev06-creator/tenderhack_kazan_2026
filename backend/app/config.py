from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["ollama", "openai"]


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
    llm_think: bool | None = False
    # Ollama и сервер могут быть недоступны при разработке: readiness без них не падает.
    llm_required: bool = False

    # Эмбеддинги можно брать у другого провайдера; пустые значения = как у LLM.
    embed_provider: Provider | None = None
    embed_base_url: str = ""
    embed_api_key: str = ""
    embed_model: str = "bge-m3"

    health_timeout_s: float = 2.0
    job_ttl_s: int = 3600

    @field_validator("embed_provider", mode="before")
    @classmethod
    def _empty_is_none(cls, value: object) -> object:
        return value or None  # EMBED_PROVIDER= в .env значит «как у LLM»


@lru_cache
def get_settings() -> Settings:
    return Settings()
