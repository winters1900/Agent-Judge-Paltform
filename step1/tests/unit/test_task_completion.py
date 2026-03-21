"""TaskCompletion 指标单元测试（规则版 + mock LLM 版）."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from data.schema import Sample, Step
from metrics.task_completion import TaskCompletion


def _sample(final_answer: str = "", user_query: str = "帮我点餐", ground_truth: str = "完成订单") -> Sample:
    return Sample(
        task_id="t1",
        user_query=user_query,
        ground_truth=ground_truth,
        steps=[],
        expected_steps=[],
        final_answer=final_answer,
    )


class TestRuleScore:
    """规则版评分."""

    def test_all_keywords_hit(self):
        metric = TaskCompletion(keywords=["pizza", "order"], use_llm=False)
        result = metric.score(_sample("I got pizza and placed an order"))
        assert result.value == pytest.approx(1.0)

    def test_partial_keywords(self):
        metric = TaskCompletion(keywords=["pizza", "order", "pay"], use_llm=False)
        result = metric.score(_sample("I got pizza"))
        assert result.value == pytest.approx(1.0 / 3.0)

    def test_no_keywords(self):
        metric = TaskCompletion(keywords=["pizza"], use_llm=False)
        result = metric.score(_sample("nothing here"))
        assert result.value == pytest.approx(0.0)

    def test_empty_keywords_list(self):
        metric = TaskCompletion(keywords=[], use_llm=False)
        result = metric.score(_sample("anything"))
        assert result.value == pytest.approx(0.0)

    def test_empty_final_answer(self):
        metric = TaskCompletion(keywords=["pizza"], use_llm=False)
        result = metric.score(_sample(""))
        assert result.value == pytest.approx(0.0)


class TestLLMScore:
    """LLM 版评分（通过 mock _call_llm）."""

    def test_llm_completed(self):
        metric = TaskCompletion(use_llm=True)
        llm_response = '{"completed": 1, "reason": "任务完成", "missing": []}'
        with patch.object(metric, "_call_llm", return_value=llm_response):
            result = metric.score(_sample("订单已完成"))
        assert result.value == pytest.approx(1.0)

    def test_llm_not_completed(self):
        metric = TaskCompletion(use_llm=True)
        llm_response = '{"completed": 0, "reason": "缺少支付", "missing": ["支付"]}'
        with patch.object(metric, "_call_llm", return_value=llm_response):
            result = metric.score(_sample("搜索完毕"))
        assert result.value == pytest.approx(0.0)
        assert "缺失要素" in result.reason

    def test_llm_returns_none_fallback_to_rule(self):
        """LLM 调用失败时自动 fallback 到规则版."""
        metric = TaskCompletion(keywords=["查询"], use_llm=True)
        with patch.object(metric, "_call_llm", return_value=None):
            result = metric.score(_sample("查询结果"))
        # fallback 规则版：包含 "查询" → 1/4 (默认4个关键词)
        assert result.value > 0.0

    def test_llm_returns_malformed_json(self):
        metric = TaskCompletion(use_llm=True)
        with patch.object(metric, "_call_llm", return_value="NOT JSON"):
            result = metric.score(_sample("anything"))
        assert result.value == pytest.approx(0.0)
        assert "解析失败" in result.reason

    def test_llm_returns_code_fenced_json(self):
        metric = TaskCompletion(use_llm=True)
        llm_response = '```json\n{"completed": 1, "reason": "ok", "missing": []}\n```'
        with patch.object(metric, "_call_llm", return_value=llm_response):
            result = metric.score(_sample("done"))
        assert result.value == pytest.approx(1.0)

    def test_llm_missing_overrides_completed(self):
        """即使 completed=1，如果 missing 非空则强制为 0."""
        metric = TaskCompletion(use_llm=True)
        llm_response = '{"completed": 1, "reason": "almost", "missing": ["支付"]}'
        with patch.object(metric, "_call_llm", return_value=llm_response):
            result = metric.score(_sample("almost done"))
        assert result.value == pytest.approx(0.0)