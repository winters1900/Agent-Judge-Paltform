from pydantic import BaseModel


class PageResult(BaseModel):
    items: list
    page: int
    page_size: int
    total: int
