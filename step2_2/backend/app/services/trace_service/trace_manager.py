from app.repositories.trace_repository import TraceRepository


class TraceManager:
    def __init__(self, trace_repository: TraceRepository) -> None:
        self.trace_repository = trace_repository
