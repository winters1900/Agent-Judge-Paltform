import { App, Button, Form, Select, Space, Table, Typography } from "antd";
import { PageTableSkeleton } from "../components/PageTableSkeleton";
import type { ColumnsType } from "antd/es/table";
import ReactECharts from "echarts-for-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compareAnalysis, listMetrics, listTasks } from "../api/api";
import { isRequestAborted } from "../api/client";
import type { AnalysisCompareResult, EvaluationTask, MetricDefinition } from "../api/types";
import { useAbortableRequest } from "../hooks/useAbortableRequest";
import { useLoadRequestId } from "../hooks/useLoadRequestId";

export function ComparePage() {
  const { message } = App.useApp();
  const { next: nextLoadId, isCurrent: isLoadCurrent } = useLoadRequestId();
  const nextSignal = useAbortableRequest();
  const [tasks, setTasks] = useState<EvaluationTask[]>([]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [result, setResult] = useState<AnalysisCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [bootReady, setBootReady] = useState(false);

  const boot = useCallback(async () => {
    const rid = nextLoadId();
    const signal = nextSignal();
    try {
      const [t, m] = await Promise.all([
        listTasks({ page: 1, page_size: 200 }, { signal }),
        listMetrics({ page: 1, page_size: 200 }, { signal }),
      ]);
      if (!isLoadCurrent(rid)) return;
      setTasks(t.items as EvaluationTask[]);
      setMetrics(m.items);
    } catch (e) {
      if (isRequestAborted(e)) return;
      if (!isLoadCurrent(rid)) return;
      message.error((e as Error).message);
    } finally {
      if (isLoadCurrent(rid)) setBootReady(true);
    }
  }, [message, nextLoadId, isLoadCurrent, nextSignal]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const onFinish = async (v: { task_ids: number[]; metric_keys: string[] }) => {
    const signal = nextSignal();
    setLoading(true);
    try {
      const res = await compareAnalysis(
        {
          task_ids: v.task_ids,
          metric_keys: v.metric_keys,
        },
        { signal },
      );
      setResult(res);
      message.success("分析完成");
    } catch (e) {
      if (!isRequestAborted(e)) message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  type PerTask = {
    task_id: number;
    run_id: number | null;
    run_code?: string;
    metrics?: Record<string, number>;
    note?: string;
  };
  type BestByMetric = Record<string, { task_id: number; value: number; lower_is_better: boolean }>;

  const detail = result?.result_detail as
    | {
        metric_keys?: string[];
        per_task?: PerTask[];
        best_by_metric?: BestByMetric;
        lower_is_better?: string[];
      }
    | undefined;

  const perTask = detail?.per_task ?? [];
  const bestByMetric = detail?.best_by_metric ?? {};
  // 后端给的指标键里，只保留至少有一个任务有数据的，避免选了无数据指标（如未配置 LLM 的 ragas）后整屏空白
  const metricKeys = useMemo(
    () => (detail?.metric_keys ?? []).filter((k) => perTask.some((t) => t.metrics && k in t.metrics)),
    [detail?.metric_keys, perTask],
  );
  const metricName = useCallback(
    (code: string) => metrics.find((m) => m.metric_code === code)?.name ?? code,
    [metrics],
  );

  // 分组柱状图：x 轴=指标，每个任务一条系列
  const chartOption = useMemo(() => {
    if (metricKeys.length === 0 || perTask.length === 0) return null;
    return {
      tooltip: { trigger: "axis" },
      legend: { data: perTask.map((t) => `任务 #${t.task_id}`) },
      grid: { bottom: 80 },
      xAxis: {
        type: "category",
        data: metricKeys.map((k) => metricName(k)),
        axisLabel: { rotate: 30 },
      },
      yAxis: { type: "value" },
      series: perTask.map((t) => ({
        name: `任务 #${t.task_id}`,
        type: "bar",
        data: metricKeys.map((k) => t.metrics?.[k] ?? 0),
      })),
    };
  }, [metricKeys, perTask, metricName]);

  // 对比表：每行一个指标，每个任务一列，标注最优任务
  type CompareRow = { key: string; metric: string } & Record<string, number | string>;
  const compareRows: CompareRow[] = useMemo(
    () =>
      metricKeys.map((k) => {
        const row: CompareRow = { key: k, metric: metricName(k) };
        for (const t of perTask) row[`task_${t.task_id}`] = t.metrics?.[k] ?? "—";
        const best = bestByMetric[k];
        row.best = best ? `任务 #${best.task_id}${best.lower_is_better ? "（越小越好）" : ""}` : "—";
        return row;
      }),
    [metricKeys, perTask, bestByMetric, metricName],
  );
  const compareColumns: ColumnsType<CompareRow> = useMemo(
    () => [
      { title: "指标", dataIndex: "metric", fixed: "left", width: 160 },
      ...perTask.map((t) => ({
        title: `任务 #${t.task_id}`,
        dataIndex: `task_${t.task_id}`,
        width: 120,
      })),
      { title: "最优", dataIndex: "best", width: 160 },
    ],
    [perTask],
  );

  return (
    <div>
      <Typography.Title level={4}>多任务对比分析</Typography.Title>
      <Typography.Paragraph type="secondary">
        基于后端已持久化的运行与样本结果做汇总（与任务需求文档「多任务对比」一致）。
      </Typography.Paragraph>
      {!bootReady ? (
        <PageTableSkeleton rows={4} />
      ) : (
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 560, marginBottom: 24 }}
          onFinish={(v) => void onFinish(v)}
          initialValues={{ task_ids: [], metric_keys: [] }}
        >
          <Form.Item
            name="task_ids"
            label="选择评测任务"
            rules={[{ required: true, message: "至少选择一个任务" }]}
          >
            <Select
              mode="multiple"
              placeholder="选择任务"
              optionFilterProp="label"
              options={tasks.map((t) => ({
                label: `${t.name} (#${t.id})`,
                value: t.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="metric_keys" label="关注指标键（用于分析上下文）">
            <Select
              mode="tags"
              placeholder="可选：从已有指标中选择或手动输入 key"
              options={metrics.map((m) => ({
                label: `${m.name} (${m.metric_code})`,
                value: m.metric_code,
              }))}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              生成对比
            </Button>
          </Form.Item>
        </Form>
      )}

      {result && (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Typography.Title level={5}>{result.title}</Typography.Title>
          <Typography.Text>
            {result.result_summary} · 分析编码 {result.analysis_code}
          </Typography.Text>
          <Space size="large" wrap>
            <Typography.Text>选中任务: {result.task_ids.join(", ")}</Typography.Text>
            <Typography.Text>有效对比指标: {metricKeys.length}</Typography.Text>
            <Typography.Text>
              有有效运行的任务: {perTask.filter((t) => t.run_id).length} / {perTask.length}
            </Typography.Text>
          </Space>
          {metricKeys.length === 0 ? (
            <Typography.Text type="warning">
              所选任务的运行中没有可对比的指标数据（可能所选指标未产出，例如未配置 LLM 的 ragas/LLM-Judge 指标，或任务尚无已完成运行）。
            </Typography.Text>
          ) : (
            <>
              {chartOption && <ReactECharts style={{ height: 360 }} option={chartOption} />}
              <Table
                title={() => "各任务指标对比"}
                rowKey="key"
                columns={compareColumns}
                dataSource={compareRows}
                pagination={false}
                size="small"
                scroll={{ x: "max-content" }}
              />
            </>
          )}
        </Space>
      )}
    </div>
  );
}
