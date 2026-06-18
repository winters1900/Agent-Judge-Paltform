import {
  ArrowLeftOutlined,
  EditOutlined,
  PlayCircleOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { App, Button, Descriptions, Progress, Space, Table, Typography } from "antd";
import { PageTableSkeleton } from "../components/PageTableSkeleton";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getTask, listRuns, runTask } from "../api/api";
import { isRequestAborted } from "../api/client";
import type { EvaluationRun, EvaluationTask } from "../api/types";
import { useAbortableRequest } from "../hooks/useAbortableRequest";
import { useLoadRequestId } from "../hooks/useLoadRequestId";
import { RunStatusTag, TaskStatusTag } from "../utils/status";

export function TaskDetailPage() {
  const { taskId } = useParams();
  const id = Number(taskId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { next: nextLoadId, isCurrent: isLoadCurrent } = useLoadRequestId();
  const nextSignal = useAbortableRequest();
  const [task, setTask] = useState<EvaluationTask | null>(null);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    const rid = nextLoadId();
    const signal = nextSignal();
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        getTask(id, { signal }),
        listRuns({ task_id: id, page: 1, page_size: 50 }, { signal }),
      ]);
      if (!isLoadCurrent(rid)) return;
      setTask(t);
      setRuns(r.items as EvaluationRun[]);
    } catch (e) {
      if (isRequestAborted(e)) return;
      if (!isLoadCurrent(rid)) return;
      message.error((e as Error).message);
    } finally {
      if (isLoadCurrent(rid)) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [id, message, nextLoadId, isLoadCurrent, nextSignal]);

  useEffect(() => {
    void load();
  }, [load]);

  const startRun = async () => {
    if (Number.isNaN(id)) return;
    setStarting(true);
    try {
      const run = await runTask(id);
      message.success("已发起评测，正在执行");
      navigate(`/runs/${run.id}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const columns: ColumnsType<EvaluationRun> = useMemo(
    () => [
      { title: "运行 ID", dataIndex: "id", width: 90 },
      { title: "编码", dataIndex: "run_code", ellipsis: true },
      {
        title: "状态",
        dataIndex: "status",
        width: 110,
        render: (s: string) => <RunStatusTag status={s} />,
      },
      {
        title: "进度",
        dataIndex: "progress",
        width: 160,
        render: (p: number) => <Progress percent={Math.min(100, Math.round(p))} size="small" />,
      },
      { title: "摘要", dataIndex: "summary", ellipsis: true },
      {
        title: "开始时间",
        dataIndex: "started_at",
        width: 170,
        render: (t: string | null) => (t ? dayjs(t).format("YYYY-MM-DD HH:mm:ss") : "—"),
      },
      {
        title: "操作",
        key: "op",
        width: 100,
        render: (_, row) => (
          <Link to={`/runs/${row.id}`}>
            <Button type="link" size="small" icon={<RocketOutlined />}>
              详情
            </Button>
          </Link>
        ),
      },
    ],
    [],
  );

  if (!task && !loading) {
    return <Typography.Text type="danger">任务不存在</Typography.Text>;
  }

  return (
    <div>
      <Space className="ide-toolbar" wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/tasks")}>
          返回列表
        </Button>
        <Link to={`/tasks/${id}/edit`}>
          <Button icon={<EditOutlined />}>编辑配置</Button>
        </Link>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={starting}
          onClick={() => void startRun()}
        >
          发起评测
        </Button>
      </Space>
      {task && (
        <Descriptions bordered size="small" column={2} style={{ marginBottom: 24 }}>
          <Descriptions.Item label="名称">{task.name}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <TaskStatusTag status={task.status} />
          </Descriptions.Item>
          <Descriptions.Item label="任务编码">{task.task_code}</Descriptions.Item>
          <Descriptions.Item label="目标 / 数据集">
            #{task.target_id} / #{task.dataset_id}
          </Descriptions.Item>
          <Descriptions.Item label="评估方法" span={2}>
            {task.evaluation_method_config?.join(", ") || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {task.description || "—"}
          </Descriptions.Item>
        </Descriptions>
      )}
      <Typography.Title level={5}>运行记录</Typography.Title>
      {!hasLoadedOnce && loading ? (
        <PageTableSkeleton rows={6} />
      ) : (
        <Table<EvaluationRun>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={runs}
          pagination={false}
        />
      )}
    </div>
  );
}
