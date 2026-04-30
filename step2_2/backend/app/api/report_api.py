from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.report_repository import ReportRepository
from app.repositories.run_repository import RunRepository
from app.schemas.report import ReportCreate, ReportExportRequest, ReportResponse
from app.services.report_service.report_manager import ReportManager

router = APIRouter(prefix="/api/v1", tags=["reports"])


def get_report_manager(db: Session = Depends(get_db)) -> ReportManager:
    return ReportManager(ReportRepository(db), RunRepository(db))


@router.get("/evaluation-runs/{run_id}/reports", response_model=list[ReportResponse])
def list_reports(run_id: int, manager: ReportManager = Depends(get_report_manager)):
    return manager.list_reports(run_id)


@router.get("/evaluation-reports/{report_id}", response_model=ReportResponse)
def get_report(report_id: int, manager: ReportManager = Depends(get_report_manager)):
    report = manager.get_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("/evaluation-reports", response_model=ReportResponse)
def create_report(payload: ReportCreate, manager: ReportManager = Depends(get_report_manager)):
    return manager.create_report(payload)


@router.post("/evaluation-runs/{run_id}/export", response_model=ReportResponse)
def export_report(
    run_id: int,
    payload: ReportExportRequest,
    manager: ReportManager = Depends(get_report_manager),
):
    return manager.export_report(run_id, payload.report_format)
