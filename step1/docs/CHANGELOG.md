# 变更日志 (CHANGELOG)

本文档记录 step1 迭代一评估框架自初始版本以来的所有变更，供贡献者了解项目演进。

---

## [2026-03-21] 项目结构迁移 & 工程化增强

### 1. 目录结构重组

将原 `迭代1/` 目录迁移为 `step1/`，保持源码、数据、文档、报告的目录分层不变。

```
step1/
├── .env.example          # 新增：环境变量模板
├── .gitignore            # 新增：step1 级别的忽略规则
├── requirements.txt      # 新增：Python 依赖清单
├── data/                 # 评估数据集
├── docs/                 # 设计文档、评估报告
├── logs/                 # 新增：运行日志（git 忽略）
├── reports/              # 评估报告输出
├── src/                  # 源码
│   ├── config.py         # 新增：集中配置管理
│   ├── main.py
│   ├── data/
│   ├── evaluator/
│   ├── metrics/
│   └── utils/
│       ├── logger.py     # 新增：统一日志模块
│       ├── hashable.py
│       └── text_norm.py
└── tests/                # 新增：完整测试套件
    ├── conftest.py
    ├── unit/
    ├── integration/
    └── e2e/
```

### 2. 环境配置系统（`config.py` + `.env`）

**新增文件**：`src/config.py`、`.env.example`

**变更说明**：

- 引入 `python-dotenv`，从项目根目录 `.env` 文件加载配置
- 支持 `Software3_1_<NAME>` 前缀的环境变量（课程项目约定），也兼容通用名称
- 提供模块级常量，`import` 即可用：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_API_KEY` | 无 | OpenAI 兼容 API Key（必填） |
| `LLM_BASE_URL` | 无 | 自定义 API 端点（可选，如 LiteLLM 代理） |
| `LLM_MODEL` | `gpt-4.1` | 模型名称 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `MAX_LOG_LINES` | `2000` | 日志文件最大行数 |
| `DEBUG` | `0` | 调试模式开关 |

**贡献者须知**：

- 复制 `.env.example` 为 `.env`，填入真实的 `LLM_API_KEY`
- `.env` 已在 `.gitignore` 中排除，**不要提交**

### 3. LLM 客户端适配（`task_completion.py`）

**修改文件**：`src/metrics/task_completion.py`

**变更说明**：

- 使用 `openai` 库的 OpenAI 兼容客户端替换原有硬编码调用
- 支持通过 `LLM_BASE_URL` 配置自定义端点（如 LiteLLM、Azure OpenAI 等）
- 增加超时（30s）和最大重试（1 次）设置
- 缺少 API Key 或 `openai` 包时自动 fallback 到规则评分
- 添加详细的日志输出（请求发送、原始响应、解析结果）

### 4. 统一日志模块（`logger.py`）

**新增文件**：`src/utils/logger.py`

**功能**：

- **双输出**：控制台（stdout）+ 文件（`logs/eval.log`）
  - 控制台输出到 `stdout`（而非默认的 `stderr`），避免 PyCharm 中日志标红
  - 文件始终记录 `DEBUG` 级别，控制台受 `LOG_LEVEL` 控制
- **自动清理**：日志文件超过 `MAX_LOG_LINES` 时保留最新的 `MAX_LOG_LINES` 行
  - 触发时机：进程启动时 + 每次 `run()` 结束时
  - 裁剪时会关闭并重新打开 FileHandler，避免文件指针偏移
- **可视化分隔符**：
  - `log_run_start(total)` — 运行间大分隔：3 空行 + `========` 粗横线
  - `log_sample_start(task_id, idx, total)` — 样本间中分隔：1 空行 + `--------` 细横线

**公开 API**：

```python
from utils.logger import get_logger, log_run_start, log_sample_start, trim_if_needed

logger = get_logger(__name__)       # 获取 logger
log_run_start(total=27)             # 评估运行开始
log_sample_start("task_001", 1, 27) # 样本开始
trim_if_needed()                    # 手动触发日志裁剪
```

### 5. 评估运行器增强（`runner.py`）

**修改文件**：`src/evaluator/runner.py`

**变更说明**：

- 集成日志模块，在评估流程中插入分隔符
- 每个样本评估后打印各指标得分
- 运行结束后自动调用 `trim_if_needed()` 裁剪日志

### 6. 测试套件

**新增文件**：`tests/` 目录下全部文件

**结构**：

| 层级 | 文件 | 覆盖内容 |
| --- | --- | --- |
| 单元测试 | `test_loader.py` | 数据加载、Schema 验证 |
| 单元测试 | `test_task_completion.py` | 任务完成度（规则 + LLM mock） |
| 单元测试 | `test_plan_quality.py` | 计划质量评分 |
| 单元测试 | `test_tool_call_accuracy.py` | 工具调用准确率 |
| 单元测试 | `test_tool_call_f1.py` | 工具调用 F1 值 |
| 集成测试 | `test_runner.py` | 评估运行器 + Markdown 报告生成 |
| 端到端测试 | `test_main_e2e.py` | 27 个样本完整评估流程 |

**运行方式**：

```bash
cd step1
pip install -r requirements.txt
python -m pytest tests/ -q
```

### 7. 依赖管理

**新增文件**：`requirements.txt`

```
openai>=1.0
python-dotenv>=1.0
httpx
pytest>=7.0
```

---

## 贡献指南

1. **环境准备**：`cp .env.example .env` 并填入 `LLM_API_KEY`
2. **安装依赖**：`pip install -r requirements.txt`
3. **运行测试**：`cd step1 && python -m pytest tests/ -q`（应 55 个测试全部通过）
4. **日志查看**：运行后查看 `step1/logs/eval.log`
5. **添加新指标**：继承 `src/metrics/base.py` 中的 `Metric` 基类，实现 `score()` 方法
6. **配置项**：所有配置通过 `.env` 管理，新增配置项请同步更新 `.env.example` 和 `config.py`