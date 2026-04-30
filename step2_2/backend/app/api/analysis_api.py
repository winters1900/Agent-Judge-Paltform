from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.run_repository import RunRepository
from app.schemas.analysis import AnalysisCompareRequest, AnalysisCompareResponse
from app.schemas.common import PageResponse
from app.services.analysis_service.analysis_manager import AnalysisManager
from app.services.pagination_service import paginate

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])


def get_analysis_manager(db: Session = Depends(get_db)) -> AnalysisManager:
    return AnalysisManager(AnalysisRepository(db), RunRepository(db))


@router.post("/compare", response_model=AnalysisCompareResponse)
def compare_analysis(payload: AnalysisCompareRequest, manager: AnalysisManager = Depends(get_analysis_manager)):
    return manager.compare(payload)


@router.get("", response_model=PageResponse)
def list_analyses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: AnalysisManager = Depends(get_analysis_manager),
):
    items = manager.list_analyses()
    return paginate(items, page=page, page_size=page_size)


@router.get("/{analysis_id}", response_model=AnalysisCompareResponse)
def get_analysis(analysis_id: int, manager: AnalysisManager = Depends(get_analysis_manager)):
    analysis = manager.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis
