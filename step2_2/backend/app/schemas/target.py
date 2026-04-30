from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EvaluationTargetCreate(BaseModel):
    target_type: str
    name: str
    description: str | None = None
    version: str
    endpoint: str | None = None
    adapter_type: str
    adapter_config: dict
    input_schema: dict | None = None
    output_schema: dict | None = None
    enabled: bool = True


class EvaluationTargetUpdate(BaseModel):
    target_type: str | None = None
    name: str | None = None
    description: str | None = None
    version: str | None = None
    endpoint: str | None = None
    adapter_type: str | None = None
    adapter_config: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    enabled: bool | None = None


class EvaluationTargetResponse(EvaluationTargetCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_code: str
    created_at: datetime
    updated_at: datetime
