from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DatasetCreate(BaseModel):
    dataset_code: str
    name: str
    description: str | None = None
    source_type: str
    version: str
    status: str


class DatasetResponse(DatasetCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sample_count: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class DatasetSampleCreate(BaseModel):
    sample_code: str
    input_payload: dict
    expected_output: dict | None = None
    reference_context: dict | None = None
    ground_truth: dict | None = None
    sample_type: str
    metadata: dict | None = None


class DatasetSampleResponse(DatasetSampleCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    dataset_id: int
    created_at: datetime
    updated_at: datetime
