from app.repositories.analysis_repository import AnalysisRepository


class AnalysisManager:
    def __init__(self, analysis_repository: AnalysisRepository) -> None:
        self.analysis_repository = analysis_repository
