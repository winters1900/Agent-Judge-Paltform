from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.metric import EvaluationMethod, MetricDefinition, MetricResult
from app.repositories.base import BaseRepository


class MetricRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def list_methods(self) -> list[EvaluationMethod]:
        stmt = select(EvaluationMethod)
        return list(self.session.scalars(stmt).all())

    def list_metrics(self) -> list[MetricDefinition]:
        stmt = select(MetricDefinition)
        return list(self.session.scalars(stmt.order_by(MetricDefinition.id.desc())).all())

    def get_metric_by_id(self, metric_id: int) -> MetricDefinition | None:
        return self.session.get(MetricDefinition, metric_id)

    def get_method_by_id(self, method_id: int) -> EvaluationMethod | None:
        return self.session.get(EvaluationMethod, method_id)

    def create_metric(self, metric: MetricDefinition) -> MetricDefinition:
        self.session.add(metric)
        self.session.commit()
        self.session.refresh(metric)
        return metric

    def update_metric(self, metric: MetricDefinition) -> MetricDefinition:
        self.session.add(metric)
        self.session.commit()
        self.session.refresh(metric)
        return metric

    def list_results(self, run_id: int, sample_id: int | None = None) -> list[MetricResult]:
        # 关联指标定义，把 code/name/type 附到结果行上（MetricResult 仅存 metric_id），
        # 否则前端图表只能回退显示 metric-{id}、表格的「指标/类型」列为空。
        stmt = (
            select(
                MetricResult,
                MetricDefinition.metric_code,
                MetricDefinition.name,
                MetricDefinition.metric_type,
            )
            .outerjoin(MetricDefinition, MetricDefinition.id == MetricResult.metric_id)
            .where(MetricResult.run_id == run_id)
            .order_by(MetricResult.sample_id, MetricResult.id)
        )
        if sample_id is not None:
            stmt = stmt.where(MetricResult.sample_id == sample_id)
        results: list[MetricResult] = []
        for row in self.session.execute(stmt).all():
            mr, code, name, mtype = row
            mr.metric_code = code
            mr.metric_name = name
            mr.metric_type = mtype
            results.append(mr)
        return results
