from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AI Coding Agent Evaluation Platform"
    environment: str = "development"
    # 生产用 MySQL；本地/演示可用 sqlite，例如 DATABASE_URL=sqlite:///./eval_platform.db
    database_url: str = "mysql+pymysql://root:password@localhost:3306/eval_platform"
    redis_url: str = "redis://localhost:6379/0"

    # ── LLM 接入（OpenAI 兼容）：被测 Agent 调用 + LLM-as-a-Judge 共用 ──
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.0
    llm_max_tokens: int = 1024
    llm_timeout_seconds: float = 60.0

    # ── 评测执行 ──
    eval_concurrency: int = 1
    eval_seed_defaults: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
