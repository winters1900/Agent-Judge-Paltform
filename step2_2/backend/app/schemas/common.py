from pydantic import BaseModel, ConfigDict


class PageParams(BaseModel):
    page: int = 1
    page_size: int = 20


class PageResponse(BaseModel):
    items: list
    page: int
    page_size: int
    total: int


class WebSocketEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event: str
    run_id: int
    status: str | None = None
    progress: float | None = None
    current_step: int | None = None
    message: str | None = None
    updated_at: str | None = None
