from uuid import uuid4

from app.models.target import EvaluationTarget
from app.repositories.target_repository import TargetRepository
from app.schemas.target import EvaluationTargetCreate, EvaluationTargetUpdate


class TargetManager:
    def __init__(self, target_repository: TargetRepository) -> None:
        self.target_repository = target_repository

    def create_target(self, payload: EvaluationTargetCreate) -> EvaluationTarget:
        target = EvaluationTarget(
            target_code=f"target_{uuid4().hex[:8]}",
            target_type=payload.target_type,
            name=payload.name,
            description=payload.description,
            version=payload.version,
            endpoint=payload.endpoint,
            adapter_type=payload.adapter_type,
            adapter_config=payload.adapter_config,
            input_schema=payload.input_schema,
            output_schema=payload.output_schema,
            enabled=payload.enabled,
        )
        return self.target_repository.create(target)

    def list_targets(self, name: str | None = None, target_type: str | None = None, enabled: bool | None = None):
        return self.target_repository.list(name=name, target_type=target_type, enabled=enabled)

    def get_target(self, target_id: int):
        return self.target_repository.get_by_id(target_id)

    def update_target(self, target_id: int, payload: EvaluationTargetUpdate):
        target = self.target_repository.get_by_id(target_id)
        if target is None:
            return None
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(target, field, value)
        return self.target_repository.update(target)

    def delete_target(self, target_id: int) -> bool:
        target = self.target_repository.get_by_id(target_id)
        if target is None:
            return False
        self.target_repository.delete(target)
        return True
