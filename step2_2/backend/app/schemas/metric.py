from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EvaluationMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    method_code: str
    name: str
    category: str
    description: str | None = None
    config_schema: dict | None = None
    enabled: bool
    created_at: datetime
    updated_at: datetime


class MetricCreate(BaseModel):
    metric_code: str
    name: str
    metric_type: str
    dimension: str
    description: str | None = None
    calc_mode: str
    config_schema: dict | None = None
    enabled: bool = True


class MetricDefinitionResponse(MetricCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class MetricResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    sample_id: int | None = None
    metric_id: int
    metric_code: str | None = None
    metric_name: str | None = None
    metric_type: str | None = None
    metric_value: float | None = None
    metric_text: str | None = None
    metric_detail: dict | None = None
    created_at: datetime
