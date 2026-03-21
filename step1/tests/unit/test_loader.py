"""数据加载器 (loader) 单元测试."""
from __future__ import annotations

import json
import os
import tempfile

import pytest
from data.loader import load_dataset


def _write_json(obj, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


class TestLoadDataset:
    """load_dataset 的基本场景."""

    def test_normal_load(self, tmp_path):
        data = [
            {
                "task_id": "1",
                "user_query": "帮我查",
                "ground_truth": "结果",
                "steps": [
                    {"step": 1, "thought": "想", "tool_call": "search", "input": '{"q":"pizza"}', "observation": "ok"}
                ],
                "expected_steps": [
                    {"step": 1, "thought": "想", "tool_call": "search", "input": '{"q":"pizza"}', "observation": "ok"}
                ],
                "final_answer": "完成",
            }
        ]
        p = str(tmp_path / "ds.json")
        _write_json(data, p)
        samples = load_dataset(p)
        assert len(samples) == 1
        assert samples[0].task_id == "1"
        assert samples[0].steps[0].tool_call == "search"
        assert samples[0].steps[0].input == {"q": "pizza"}

    def test_empty_array(self, tmp_path):
        p = str(tmp_path / "empty.json")
        _write_json([], p)
        samples = load_dataset(p)
        assert samples == []

    def test_missing_fields_use_defaults(self, tmp_path):
        data = [{"task_id": "2"}]
        p = str(tmp_path / "partial.json")
        _write_json(data, p)
        samples = load_dataset(p)
        assert len(samples) == 1
        assert samples[0].user_query == ""
        assert samples[0].steps == []

    def test_not_array_raises(self, tmp_path):
        p = str(tmp_path / "bad.json")
        _write_json({"task_id": "1"}, p)
        with pytest.raises(ValueError, match="JSON 数组"):
            load_dataset(p)

    def test_malformed_input_json_string(self, tmp_path):
        """input 字段为非法 JSON 字符串时应返回空 dict."""
        data = [
            {
                "task_id": "3",
                "steps": [{"step": 1, "thought": "", "tool_call": "t", "input": "NOT_JSON", "observation": ""}],
                "expected_steps": [],
            }
        ]
        p = str(tmp_path / "bad_input.json")
        _write_json(data, p)
        samples = load_dataset(p)
        assert samples[0].steps[0].input == {}