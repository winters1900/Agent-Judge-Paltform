from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RunCreate(BaseModel):
    run_code: str
    task_id: int
    status: str = "queued"
    progress: float = 0.0
    current_sample_id: int | None = None
    retry_count: int = 0
    summary: str | None = None
    trace_id: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class RunSummaryResponse(BaseModel):
    run_id: int
    summary: str | None = None
    report_title: str | None = None
    report_path: str | None = None
    report_format: str | None = None


class RunCancelResponse(BaseModel):
    run_id: int
    status: str
    message: str


class EvaluationRunResponse(RunCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class SampleResultCreate(BaseModel):
    run_id: int
    sample_id: int
    status: str
    input_snapshot: dict
    output_snapshot: dict | None = None
    score_summary: dict | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class SampleResultResponse(SampleResultCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
