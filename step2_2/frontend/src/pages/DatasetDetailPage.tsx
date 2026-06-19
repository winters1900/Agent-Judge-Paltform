import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table, Typography } from "antd";
import { PageTableSkeleton } from "../components/PageTableSkeleton";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createDatasetSample,
  deleteDatasetSample,
  getDataset,
  importDatasetSamples,
  listDatasetSamples,
} from "../api/api";
import { isRequestAborted } from "../api/client";
import type { Dataset, DatasetSample } from "../api/types";
import { useAbortableRequest } from "../hooks/useAbortableRequest";
import { useLoadRequestId } from "../hooks/useLoadRequestId";

const SAMPLE_TYPES = [
  { value: "generic_qa", label: "通用问答" },
  { value: "tool_use", label: "工具使用" },
  { value: "workflow", label: "流程执行" },
  { value: "multi_turn", label: "多轮交互" },
  { value: "structured_output", label: "结构化输出" },
  { value: "planning", label: "计划生成" },
  { value: "task_decomposition", label: "任务拆解" },
  { value: "code_edit", label: "代码修改（示例）" },
];

type SampleImportItem = {
  sample_code: string;
  sample_type: string;
  input_payload: Record<string, unknown>;
  expected_output?: Record<string, unknown> | null;
  reference_context?: Record<string, unknown> | null;
  ground_truth?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

const IMPORT_EXAMPLE = JSON.stringify(
  [
    {
      sample_code: "case_all_tests_repair",
      sample_type: "code_edit",
      input_payload: {
        prompt: "请修复当前项目中的所有失败测试。最后运行 npm test。",
        selectedFile: null,
      },
      expected_output: { answer: "npm test 通过" },
      ground_truth: {
        keywords: ["npm test", "通过"],
        tool_calls: [
          { tool_name: "list_workspace" },
          { tool_name: "read_file" },
          { tool_name: "patch_file" },
          { tool_name: "run_command" },
        ],
      },
      reference_context: {
        contexts: ["主要修改应位于 src 目录，不应删除或弱化测试。"],
      },
    },
  ],
  null,
  2,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseImportSamples(raw: string): SampleImportItem[] {
  const parsed = JSON.parse(raw) as unknown;
  const samples = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && isRecord(parsed.input_payload)
      ? [parsed]
    : isRecord(parsed) && Array.isArray(parsed.samples)
      ? parsed.samples
      : null;
  if (!samples) {
    throw new Error("JSON 须为单个样本对象、样本数组，或 {\"samples\": [...]}");
  }
  return samples.map((sample, index) => {
    if (!isRecord(sample)) {
      throw new Error(`第 ${index + 1} 条不是对象`);
    }
    if (typeof sample.sample_code !== "string" || !sample.sample_code.trim()) {
      throw new Error(`第 ${index + 1} 条缺少 sample_code`);
    }
    if (!isRecord(sample.input_payload)) {
      throw new Error(`第 ${index + 1} 条缺少 input_payload 对象`);
    }
    return {
      sample_code: sample.sample_code,
      sample_type: typeof sample.sample_type === "string" ? sample.sample_type : "generic_qa",
      input_payload: sample.input_payload,
      expected_output: isRecord(sample.expected_output) ? sample.expected_output : null,
      reference_context: isRecord(sample.reference_context) ? sample.reference_context : null,
      ground_truth: isRecord(sample.ground_truth) ? sample.ground_truth : null,
      metadata: isRecord(sample.metadata) ? sample.metadata : null,
    };
  });
}

export function DatasetDetailPage() {
  const { datasetId } = useParams();
  const id = Number(datasetId);
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { next: nextLoadId, isCurrent: isLoadCurrent } = useLoadRequestId();
  const nextSignal = useAbortableRequest();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [samples, setSamples] = useState<DatasetSample[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form] = Form.useForm();
  const [importForm] = Form.useForm();
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    const rid = nextLoadId();
    const signal = nextSignal();
    setLoading(true);
    try {
      const d = await getDataset(id, { signal });
      if (!isLoadCurrent(rid)) return;
      setDataset(d);
    } catch (e) {
      if (isRequestAborted(e)) return;
      if (!isLoadCurrent(rid)) return;
      message.error((e as Error).message);
      setDataset(null);
    }
    try {
      const s = await listDatasetSamples(id, { page, page_size: pageSize }, { signal });
      if (!isLoadCurrent(rid)) return;
      setSamples(s.items as DatasetSample[]);
      setTotal(s.total);
    } catch (e) {
      if (isRequestAborted(e)) return;
      if (!isLoadCurrent(rid)) return;
      message.error((e as Error).message);
      setSamples([]);
      setTotal(0);
    } finally {
      if (isLoadCurrent(rid)) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [id, message, page, pageSize, nextLoadId, isLoadCurrent, nextSignal]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitSample = async () => {
    const v = await form.validateFields();
    let input_payload: Record<string, unknown>;
    let expected_output: Record<string, unknown> | undefined;
    let reference_context: Record<string, unknown> | undefined;
    let ground_truth: Record<string, unknown> | undefined;
    let metadata: Record<string, unknown> | undefined;
    try {
      input_payload = JSON.parse(v.input_json) as Record<string, unknown>;
      if (v.expected_json) expected_output = JSON.parse(v.expected_json) as Record<string, unknown>;
      if (v.reference_json) reference_context = JSON.parse(v.reference_json) as Record<string, unknown>;
      if (v.ground_truth_json) ground_truth = JSON.parse(v.ground_truth_json) as Record<string, unknown>;
      if (v.metadata_json) metadata = JSON.parse(v.metadata_json) as Record<string, unknown>;
    } catch {
      message.error("JSON 字段格式不正确");
      return;
    }
    try {
      await createDatasetSample(id, {
        sample_code: v.sample_code,
        sample_type: v.sample_type,
        input_payload,
        expected_output: expected_output ?? null,
        reference_context: reference_context ?? null,
        ground_truth: ground_truth ?? null,
        metadata: metadata ?? null,
      });
      message.success("样本已添加");
      setOpen(false);
      form.resetFields();
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submitImport = async () => {
    const v = await importForm.validateFields();
    let samplesToImport: SampleImportItem[];
    try {
      samplesToImport = parseImportSamples(v.samples_json);
    } catch (e) {
      message.error((e as Error).message);
      return;
    }
    if (samplesToImport.length === 0) {
      message.error("至少提供一条样本");
      return;
    }
    try {
      const created = await importDatasetSamples(id, samplesToImport);
      message.success(`已导入 ${created.length} 条样本`);
      setImportOpen(false);
      importForm.resetFields();
      setPage(1);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<DatasetSample> = useMemo(
    () => [
      { title: "ID", dataIndex: "id", width: 70 },
      { title: "样本编码", dataIndex: "sample_code", ellipsis: true },
      { title: "类型", dataIndex: "sample_type", width: 140 },
      {
        title: "输入",
        dataIndex: "input_payload",
        ellipsis: true,
        render: (v: Record<string, unknown>) => (
          <span className="ide-mono">{JSON.stringify(v)}</span>
        ),
      },
      {
        title: "创建时间",
        dataIndex: "created_at",
        width: 170,
        render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
      },
      {
        title: "操作",
        key: "op",
        width: 100,
        render: (_, row) => (
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: "删除该样本？",
                onOk: async () => {
                  await deleteDatasetSample(id, row.id);
                  message.success("已删除");
                  void load();
                },
              })
            }
          >
            删除
          </Button>
        ),
      },
    ],
    [id, load, message, modal],
  );

  if (!dataset && !loading) {
    return <Typography.Text type="danger">数据集不存在</Typography.Text>;
  }

  return (
    <div>
      <Space className="ide-toolbar" wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/datasets")}>
          返回
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({
              sample_type: "generic_qa",
              input_json: '{"task":"示例输入"}',
            });
            setOpen(true);
          }}
        >
          添加样本
        </Button>
        <Button
          icon={<UploadOutlined />}
          onClick={() => {
            importForm.resetFields();
            importForm.setFieldsValue({ samples_json: IMPORT_EXAMPLE });
            setImportOpen(true);
          }}
        >
          JSON 导入
        </Button>
      </Space>
      {dataset && (
        <Typography.Paragraph>
          <Typography.Text strong>{dataset.name}</Typography.Text>（{dataset.dataset_code}）· 样本{" "}
          {dataset.sample_count}
        </Typography.Paragraph>
      )}
      {!hasLoadedOnce && loading ? (
        <PageTableSkeleton rows={7} />
      ) : (
        <Table<DatasetSample>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={samples}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      )}
      <Modal
        title="添加样本"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submitSample()}
        width={640}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="sample_code" label="样本编码" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sample_type" label="样本类型" rules={[{ required: true }]}>
            <Select options={SAMPLE_TYPES} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="input_json" label="input_payload (JSON)" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="expected_json" label="expected_output (JSON)">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
          <Form.Item name="reference_json" label="reference_context (JSON)">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <Form.Item name="ground_truth_json" label="ground_truth (JSON)">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <Form.Item name="metadata_json" label="metadata (JSON)">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="JSON 导入样本"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={() => void submitImport()}
        okText="导入"
        width={860}
        destroyOnHidden
        forceRender
      >
        <Typography.Paragraph type="secondary">
          粘贴样本数组，或 {"{\"samples\": [...]}"}。每条至少包含 sample_code 和 input_payload。
        </Typography.Paragraph>
        <Form form={importForm} layout="vertical">
          <Form.Item name="samples_json" label="样本 JSON" rules={[{ required: true }]}>
            <Input.TextArea rows={18} className="ide-mono" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
