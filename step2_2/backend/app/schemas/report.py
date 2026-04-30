from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReportCreate(BaseModel):
    run_id: int
    report_title: str
    report_summary: str | None = None
    report_path: str | None = None
    report_format: str


class ReportExportRequest(BaseModel):
    report_format: str = "pdf"


class ReportResponse(ReportCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
