from pydantic import BaseModel, ConfigDict


class AnalysisCompareRequest(BaseModel):
    task_ids: list[int]
    metric_keys: list[str]


class AnalysisCompareResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    analysis_code: str
    title: str
    task_ids: list[int]
    metric_keys: list[str]
    result_summary: str | None = None
    result_detail: dict | None = None
