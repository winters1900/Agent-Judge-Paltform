from app.repositories.metric_repository import MetricRepository


class MetricManager:
    def __init__(self, metric_repository: MetricRepository) -> None:
        self.metric_repository = metric_repository
