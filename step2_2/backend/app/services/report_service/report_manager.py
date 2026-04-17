from app.repositories.report_repository import ReportRepository


class ReportManager:
    def __init__(self, report_repository: ReportRepository) -> None:
        self.report_repository = report_repository
