from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EvaluationTaskCreate(BaseModel):
    name: str
    description: str | None = None
    agent_id: str
    dataset_id: int
    evaluation_method_config: list[str] = Field(default_factory=list)
    metric_config: dict = Field(default_factory=dict)
    run_config: dict = Field(default_factory=dict)
    status: str = "draft"
    created_by: int | None = None
    updated_by: int | None = None


class EvaluationTaskUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    agent_id: str | None = None
    dataset_id: int | None = None
    evaluation_method_config: list[str] | None = None
    metric_config: dict | None = None
    run_config: dict | None = None
    status: str | None = None
    updated_by: int | None = None


class EvaluationTaskResponse(EvaluationTaskCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_code: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
