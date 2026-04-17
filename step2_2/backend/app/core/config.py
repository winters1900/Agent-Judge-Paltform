from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Agent Evaluation Platform"
    environment: str = "development"
    database_url: str = "mysql+pymysql://user:password@localhost:3306/eval_platform"
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()
