from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TraceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    sample_id: int | None = None
    step_index: int
    phase: str
    decision: str | None = None
    observation: str | None = None
    state_snapshot: dict | None = None
    tool_calls: dict | None = None
    created_at: datetime
    updated_at: datetime


class ToolCallLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    sample_id: int | None = None
    tool_name: str
    input_payload: dict
    output_payload: dict | None = None
    success: bool
    error_type: str | None = None
    duration_ms: int
    created_at: datetime
    updated_at: datetime
