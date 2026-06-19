import {
  ArrowLeftOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Descriptions,
  List,
  Progress,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import ReactECharts from "echarts-for-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  cancelRun,
  exportRunReport,
  getRun,
  getRunSummary,
  getTask,
  listReports,
  listRunMetrics,
  listSampleResults,
  listToolCalls,
  listTraces,
  pauseRun,
  resumeRun,
  retryRun,
} from "../api/api";
import { isRequestAborted, wsUrlForRun } from "../api/client";
import type {
  EvaluationRun,
  EvaluationTask,
  MetricResult,
  Report,
  SampleResult,
  ToolCallLog,
  TraceRecord,
  WebSocketEvent,
} from "../api/types";
import { useAbortableRequest } from "../hooks/useAbortableRequest";
import { useLoadRequestId } from "../hooks/useLoadRequestId";
import { RunStatusTag } from "../utils/status";

const CHART_PRIMARY = "#2c5282";

export function RunDetailPage() {
  const { runId } = useParams();
  const id = Number(runId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { next: nextLoadId, isCurrent: isLoadCurrent } = useLoadRequestId();
  const nextSignal = useAbortableRequest();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [task, setTask] = useState<EvaluationTask | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleResult[]>([]);
  const [metrics, setMetrics] = useState<MetricResult[]>([]);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallLog[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsLog, setWsLog] = useState<WebSocketEvent[]>([]);
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const wsBufferRef = useRef<WebSocketEvent[]>([]);
  const wsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    const rid = nextLoadId();
    const signal = nextSignal();
    setLoading(true);
    try {
      const r = await getRun(id, { signal });
      if (!isLoadCurrent(rid)) return;
      setRun(r);

      const [t, sm, samp, met, tr, tc, rep] = await Promise.all([
        getTask(r.task_id, { signal }),
        getRunSummary(id, { signal }).catch(() => null),
        listSampleResults(id, { signal }).catch(() => []),
        listRunMetrics(id, { signal }).catch(() => []),
        listTraces(id, { page: 1, page_size: 100 }, { signal }).catch(() => ({ items: [] })),
        listToolCalls(id, { page: 1, page_size: 100 }, { signal }).catch(() => ({ items: [] })),
        listReports(id, { signal }).catch(() => []),
      ]);
      if (!isLoadCurrent(rid)) return;
      setTask(t);
      setSummary(sm?.summary ?? r.summary);
      setSamples(samp);
      setMetrics(met);
      setTraces(tr.items as TraceRecord[]);
      setToolCalls(tc.items as ToolCallLog[]);
      setReports(rep);
    } catch (e) {
      if (isRequestAborted(e)) return;
      if (!isLoadCurrent(rid)) return;
      message.error((e as Error).message);
    } finally {
      if (isLoadCurrent(rid)) setLoading(false);
    }
  }, [id, message, nextLoadId, isLoadCurrent, nextSignal]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    const el = terminalScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [wsLog]);

  useEffect(() => {
    if (Number.isNaN(id)) return;
    const url = wsUrlForRun(id);
    const ws = new WebSocket(url);

    const flush = () => {
      wsFlushTimerRef.current = null;
      const batch = wsBufferRef.current;
      wsBufferRef.current = [];
      if (batch.length === 0) return;
      const last = batch[batch.length - 1];
      setWsLog((prev) => [...prev, ...batch].slice(-120));
      setRun((prev) => {
        if (!prev || prev.id !== id) return prev;
        const next = { ...prev };
        if (last.progress != null) next.progress = last.progress;
        if (last.status) next.status = last.status as EvaluationRun["status"];
        return next;
      });
    };

    const scheduleFlush = () => {
      if (wsFlushTimerRef.current != null) return;
      wsFlushTimerRef.current = setTimeout(flush, 48);
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as WebSocketEvent;
        wsBufferRef.current.push(data);
        scheduleFlush();
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      /* dev 下后端未启动时静默 */
    };
    return () => {
      if (wsFlushTimerRef.current != null) {
        clearTimeout(wsFlushTimerRef.current);
        wsFlushTimerRef.current = null;
      }
      wsBufferRef.current = [];
      ws.close();
    };
  }, [id]);

  const runAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const sampleColumns: ColumnsType<SampleResult> = useMemo(
    () => [
      { title: "样本 ID", dataIndex: "sample_id", width: 90 },
      { title: "状态", dataIndex: "status", width: 100 },
      {
        title: "输入快照",
        dataIndex: "input_snapshot",
        render: (v: Record<string, unknown>) => (
          <Typography.Paragraph
            className="ide-mono"
            copyable
            ellipsis={{ rows: 2 }}
            style={{ margin: 0 }}
          >
            {JSON.stringify(v)}
          </Typography.Paragraph>
        ),
      },
      {
        title: "输出快照",
        dataIndex: "output_snapshot",
        render: (v: Record<string, unknown> | null) =>
          v ? (
            <Typography.Paragraph
              className="ide-mono"
              copyable
              ellipsis={{ rows: 2 }}
              style={{ margin: 0 }}
            >
              {JSON.stringify(v)}
            </Typography.Paragraph>
          ) : (
            "—"
          ),
      },
      {
        title: "评分摘要",
        dataIndex: "score_summary",
        width: 120,
        render: (v: Record<string, unknown> | null) =>
          v ? (
            <span className="ide-mono">{JSON.stringify(v)}</span>
          ) : (
            "—"
          ),
      },
    ],
    [],
  );

  const metricColumns: ColumnsType<MetricResult> = useMemo(
    () => [
      { title: "指标", dataIndex: "metric_name", render: (_, r) => r.metric_name || r.metric_code },
      { title: "类型", dataIndex: "metric_type", width: 100 },
      {
        title: "样本",
        dataIndex: "sample_id",
        width: 90,
        render: (v: number | null) => (v == null ? <Tag>汇总</Tag> : `#${v}`),
      },
      { title: "数值", dataIndex: "metric_value", width: 100 },
      { title: "文本", dataIndex: "metric_text", ellipsis: true },
    ],
    [],
  );

  const traceColumns: ColumnsType<TraceRecord> = useMemo(
    () => [
      { title: "步序", dataIndex: "step_index", width: 70 },
      { title: "阶段", dataIndex: "phase", width: 90 },
      { title: "决策", dataIndex: "decision", ellipsis: true },
      { title: "观察", dataIndex: "observation", ellipsis: true },
      {
        title: "时间",
        dataIndex: "created_at",
        width: 170,
        render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm:ss"),
      },
    ],
    [],
  );

  const toolColumns: ColumnsType<ToolCallLog> = useMemo(
    () => [
      { title: "工具", dataIndex: "tool_name", width: 140 },
      {
        title: "成功",
        dataIndex: "success",
        width: 80,
        render: (v: boolean) => (v ? <Tag color="success">是</Tag> : <Tag color="error">否</Tag>),
      },
      { title: "耗时 ms", dataIndex: "duration_ms", width: 100 },
      {
        title: "输入",
        dataIndex: "input_payload",
        ellipsis: true,
        render: (v: Record<string, unknown>) => (
          <span className="ide-mono">{JSON.stringify(v)}</span>
        ),
      },
    ],
    [],
  );

  const metricChart = useMemo(() => {
    if (metrics.length === 0) return null;
    // 按指标聚合：用样本级结果求均值（忽略空值与 run 级聚合行），每个指标只出一根柱
    const buckets = new Map<string, { name: string; vals: number[] }>();
    for (const m of metrics) {
      if (m.sample_id == null || m.metric_value == null) continue;
      const code = m.metric_code || `metric-${m.metric_id}`;
      const name = m.metric_name || m.metric_code || `metric-${m.metric_id}`;
      const b = buckets.get(code) ?? { name, vals: [] };
      b.vals.push(Number(m.metric_value));
      buckets.set(code, b);
    }
    const rows = [...buckets.values()].map((b) => ({
      name: b.name,
      value: b.vals.reduce((s, v) => s + v, 0) / b.vals.length,
    }));
    if (rows.length === 0) return null;
    // 按量级拆双 y 轴：分数类(0~1，如成功率/准确率/F1)走左轴，量级类(ms/tokens)走右轴，
    // 否则上万的 token/耗时会把 0~1 的分数柱压到看不见。
    const isMagnitude = (v: number) => v > 5;
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["分数 (0~1)", "量级 (ms/tokens)"] },
      grid: { bottom: 90 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.name),
        axisLabel: { rotate: 30 },
      },
      yAxis: [
        { type: "value", name: "分数", min: 0, position: "left" },
        { type: "value", name: "量级", min: 0, position: "right" },
      ],
      series: [
        {
          name: "分数 (0~1)",
          type: "bar",
          yAxisIndex: 0,
          data: rows.map((r) => (isMagnitude(r.value) ? null : Number(r.value.toFixed(4)))),
          itemStyle: { color: CHART_PRIMARY },
        },
        {
          name: "量级 (ms/tokens)",
          type: "bar",
          yAxisIndex: 1,
          data: rows.map((r) => (isMagnitude(r.value) ? Math.round(r.value) : null)),
          itemStyle: { color: "#dd6b20" },
        },
      ],
    };
  }, [metrics]);

  const tabItems = useMemo(
    () => [
      {
        key: "samples",
        label: "样本结果",
        children: (
          <Table
            rowKey="id"
            size="small"
            columns={sampleColumns}
            dataSource={samples}
            pagination={false}
          />
        ),
      },
      {
        key: "metrics",
        label: "指标",
        children: (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            {metricChart ? <ReactECharts style={{ height: 320 }} option={metricChart} /> : null}
            <Table
              rowKey="id"
              size="small"
              columns={metricColumns}
              dataSource={metrics}
              pagination={false}
            />
          </Space>
        ),
      },
      {
        key: "traces",
        label: "过程轨迹",
        children: (
          <Table
            rowKey="id"
            size="small"
            columns={traceColumns}
            dataSource={traces}
            pagination={false}
          />
        ),
      },
      {
        key: "tools",
        label: "工具调用",
        children: (
          <Table
            rowKey="id"
            size="small"
            columns={toolColumns}
            dataSource={toolCalls}
            pagination={false}
          />
        ),
      },
      {
        key: "reports",
        label: "报告",
        children: (
          <List
            dataSource={reports}
            locale={{ emptyText: "暂无报告，可先点击「导出报告」" }}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={item.report_title}
                  description={`格式: ${item.report_format} · ${item.report_path || "无路径"}`}
                />
              </List.Item>
            )}
          />
        ),
      },
    ],
    [
      samples,
      metrics,
      traces,
      toolCalls,
      reports,
      metricChart,
      sampleColumns,
      metricColumns,
      traceColumns,
      toolColumns,
    ],
  );

  if (!run && !loading) {
    return <Typography.Text type="danger">运行记录不存在</Typography.Text>;
  }

  return (
    <div>
      <Space className="ide-toolbar" wrap>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(run ? `/tasks/${run.task_id}` : "/tasks")}
        >
          返回任务
        </Button>
        <Button
          icon={<PauseCircleOutlined />}
          onClick={() => void runAction(() => pauseRun(id), "已暂停")}
          disabled={!run || !["queued", "running"].includes(run.status)}
        >
          暂停
        </Button>
        <Button
          icon={<PlayCircleOutlined />}
          onClick={() => void runAction(() => resumeRun(id), "已恢复")}
          disabled={!run || run.status !== "paused"}
        >
          恢复
        </Button>
        <Button
          danger
          icon={<StopOutlined />}
          onClick={() => void runAction(() => cancelRun(id), "已取消")}
          disabled={!run}
        >
          取消
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void runAction(() => retryRun(id), "已重试排队")}
          disabled={!run || !["failed", "cancelled", "completed"].includes(run.status)}
        >
          重试
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() =>
            void runAction(async () => {
              await exportRunReport(id, "pdf");
            }, "已生成导出记录")
          }
        >
          导出报告
        </Button>
      </Space>

      {run && (
        <Card size="small" loading={loading} style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="运行 ID">{run.id}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <RunStatusTag status={run.status} />
            </Descriptions.Item>
            <Descriptions.Item label="编码">{run.run_code}</Descriptions.Item>
            <Descriptions.Item label="关联任务">
              {task ? (
                <Link to={`/tasks/${task.id}`}>
                  {task.name} (#{task.id})
                </Link>
              ) : (
                `#${run.task_id}`
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Trace">{run.trace_id || "—"}</Descriptions.Item>
            <Descriptions.Item label="重试次数">{run.retry_count}</Descriptions.Item>
            <Descriptions.Item label="摘要" span={2}>
              {summary || run.summary || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="错误" span={2}>
              <span className="ide-mono" style={{ color: "inherit", whiteSpace: "pre-wrap" }}>
                {run.error_message || "—"}
              </span>
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">执行进度</Typography.Text>
            <Progress
              percent={Math.min(100, Math.round(run.progress))}
              status={run.status === "failed" ? "exception" : "active"}
            />
          </div>
        </Card>
      )}

      <Card
        size="small"
        title={<span style={{ fontSize: 13, fontWeight: 600 }}>OUTPUT · 实时事件</span>}
        style={{ marginBottom: 16 }}
      >
        <div ref={terminalScrollRef} className="ide-terminal">
          <List
            size="small"
            dataSource={wsLog}
            locale={{ emptyText: "等待推送…（需后端与代理支持 WS）" }}
            renderItem={(item) => (
              <List.Item style={{ border: "none" }}>
                <Space direction="vertical" size={0} style={{ width: "100%" }}>
                  <Space size={8}>
                    <Tag style={{ fontFamily: "var(--ide-mono)", fontSize: 11 }}>{item.event}</Tag>
                    <Typography.Text type="secondary" className="ide-mono" style={{ fontSize: 11 }}>
                      {item.updated_at}
                    </Typography.Text>
                  </Space>
                  <Typography.Text className="ide-mono" style={{ fontSize: 12 }}>
                    {item.message} · progress {item.progress ?? "—"}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      </Card>

      <Tabs
        className="ide-tabs"
        type="card"
        destroyInactiveTabPane={false}
        items={tabItems}
      />
    </div>
  );
}
