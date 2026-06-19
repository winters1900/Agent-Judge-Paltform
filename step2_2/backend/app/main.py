from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis_api import router as analysis_router
from app.api.dataset_api import router as dataset_router
from app.api.metric_api import router as metric_router
from app.api.report_api import router as report_router
from app.api.run_api import router as run_router
from app.api.target_api import router as target_router
from app.api.task_api import router as task_router
from app.api.trace_api import router as trace_router
from app.api.ws_api import router as ws_router
from app.core.config import settings
from app.core.database import SessionLocal, init_db
from app.services.evaluation.runner import reconcile_orphaned_runs
from app.services.evaluation.seed import seed_defaults


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if settings.eval_seed_defaults:
        session = SessionLocal()
        try:
            seed_defaults(session)
        finally:
            session.close()
    # 重启后把丢失了后台任务的非终态 run 收尾为 failed，避免永久卡在 running。
    reconcile_orphaned_runs()
    yield


app = FastAPI(title="通用 Agent 评估平台", version="0.1.0", lifespan=lifespan)

# 前后端分离：开发期放开 CORS（生产应收敛为具体来源）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(target_router)
app.include_router(task_router)
app.include_router(run_router)
app.include_router(dataset_router)
app.include_router(metric_router)
app.include_router(trace_router)
app.include_router(report_router)
app.include_router(analysis_router)
app.include_router(ws_router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
