from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    report_title: str
    report_summary: str | None = None
    report_path: str | None = None
    report_format: str
    created_at: datetime
    updated_at: datetime
