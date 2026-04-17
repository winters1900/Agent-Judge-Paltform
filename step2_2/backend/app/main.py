from fastapi import FastAPI

from app.api.dataset_api import router as dataset_router
from app.api.run_api import router as run_router
from app.api.task_api import router as task_router
from app.core.database import init_db

app = FastAPI(title="Agent Evaluation Platform", version="0.1.0")

app.include_router(task_router)
app.include_router(run_router)
app.include_router(dataset_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
