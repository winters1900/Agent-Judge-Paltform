import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Typography } from "antd";
import { PageTableSkeleton } from "../components/PageTableSkeleton";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type AdapterPreset,
  createTarget,
  deleteTarget,
  listTargetPresets,
  listTargets,
  testTarget,
  updateTarget,
} from "../api/api";
import { isRequestAborted } from "../api/client";
import type { EvaluationTarget } from "../api/types";

const ADAPTER_TYPES = ["openai", "http_sse", "http_json", "claude_code", "mock"];
import { useAbortableRequest } from "../hooks/useAbortableRequest";
import { useLoadRequestId } from "../hooks/useLoadRequestId";

export function TargetsPage() {
  const { message, modal } = App.useApp();
  const { next: nextLoadId, isCurrent: isLoadCurrent } = useLoadRequestId();
  const nextSignal = useAbortableRequest();
  const [data, setData] = useState<EvaluationTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EvaluationTarget | null>(null);
  const [form] = Form.useForm();
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [presets, setPresets] = useState<AdapterPreset[]>([]);
  const [testing, setTesting] = useState(false);
  const watchedAdapterType = Form.useWatch("adapter_type", form);

  useEffect(() => {
    listTargetPresets()
      .then(setPresets)
      .catch(() => undefined);
  }, []);

  const applyPreset = (label: string) => {
    const p = presets.find((x) => x.label === label);
    if (!p) return;
    form.setFieldsValue({
      adapter_type: p.adapter_type,
      endpoint: p.endpoint,
      adapter_config_json: JSON.stringify(p.config, null, 2),
    });
  };

  const runTest = async () => {
    const v = await form.validateFields(["adapter_type", "adapter_config_json"]);
    let adapter_config: Record<string, unknown> = {};
    try {
      adapter_config = v.adapter_config_json ? JSON.parse(v.adapter_config_json as string) : {};
    } catch {
      message.error("adapter_config 不是合法 JSON");
      return;
    }
    setTesting(true);
    try {
      const r = await testTarget({
        adapter_type: v.adapter_type,
        endpoint: form.getFieldValue("endpoint") ?? null,
        adapter_config,
      });
      modal.info({
        title: r.succeeded ? "连通成功 ✅" : "连通失败 ❌",
        width: 560,
        content: (
          <div>
            <p>耗时 {r.latency_ms}ms · tokens {r.total_tokens} · 工具调用 {r.tool_calls.length}</p>
            {r.error ? (
              <Alert type="error" message={r.error} />
            ) : (
              <Input.TextArea readOnly value={r.output_text} autoSize={{ minRows: 2, maxRows: 10 }} />
            )}
          </div>
        ),
      });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const load = useCallback(async () => {
    const rid = nextLoadId();
    const signal = nextSignal();
    setLoading(true);
    try {
      const items = await listTargets(undefined, { signal });
      if (!isLoadCurrent(rid)) return;
      setData(items);
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
  }, [message, nextLoadId, isLoadCurrent, nextSignal]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      adapter_type: "openai",
      adapter_config_json: JSON.stringify({ base_url: "", api_key: "", model: "" }, null, 2),
    });
    setOpen(true);
  };

  const openEdit = useCallback(
    (row: EvaluationTarget) => {
      setEditing(row);
      form.setFieldsValue({
        ...row,
        adapter_config_json: JSON.stringify(row.adapter_config ?? {}, null, 2),
      });
      setOpen(true);
    },
    [form],
  );

  const submit = async () => {
    const v = await form.validateFields();
    let adapter_config: Record<string, unknown> = {};
    if (v.adapter_config_json) {
      try {
        adapter_config = JSON.parse(v.adapter_config_json as string) as Record<string, unknown>;
      } catch {
        message.error("adapter_config 不是合法 JSON");
        return;
      }
    } else if (v.adapter_config) {
      adapter_config = v.adapter_config;
    }
    try {
      if (editing) {
        await updateTarget(editing.id, {
          target_type: v.target_type,
          name: v.name,
          description: v.description,
          version: v.version,
          endpoint: v.endpoint,
          adapter_type: v.adapter_type,
          adapter_config,
          enabled: v.enabled,
        });
        message.success("已更新");
      } else {
        await createTarget({
          target_type: v.target_type,
          name: v.name,
          description: v.description ?? null,
          version: v.version,
          endpoint: v.endpoint ?? null,
          adapter_type: v.adapter_type,
          adapter_config,
          input_schema: null,
          output_schema: null,
          enabled: v.enabled ?? true,
        });
        message.success("已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<EvaluationTarget> = useMemo(
    () => [
      { title: "ID", dataIndex: "id", width: 70 },
      { title: "编码", dataIndex: "target_code", ellipsis: true },
      { title: "名称", dataIndex: "name", ellipsis: true },
      { title: "类型", dataIndex: "target_type", width: 130, ellipsis: true },
      { title: "版本", dataIndex: "version", width: 100 },
      {
        title: "启用",
        dataIndex: "enabled",
        width: 80,
        render: (v: boolean) => (v ? "是" : "否"),
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
        width: 160,
        render: (_, row) => (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() =>
                modal.confirm({
                  title: "删除该评测目标？",
                  onOk: async () => {
                    await deleteTarget(row.id);
                    message.success("已删除");
                    void load();
                  },
                })
              }
            >
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [load, message, modal, openEdit],
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          评测目标
        </Typography.Title>
        <Space>
          <Typography.Link>
            <Link to="/tasks">去创建评测任务</Link>
          </Typography.Link>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建目标
          </Button>
        </Space>
      </div>
      {!hasLoadedOnce && loading ? (
        <PageTableSkeleton rows={7} />
      ) : (
        <Table<EvaluationTarget>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={data}
        />
      )}
      <Modal
        title={editing ? "编辑评测目标" : "新建评测目标"}
        open={open}
        onCancel={() => setOpen(false)}
        width={640}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button key="test" icon={<ThunderboltOutlined />} loading={testing} onClick={() => void runTest()}>
            测试连通性
          </Button>,
          <Button key="ok" type="primary" onClick={() => void submit()}>
            保存
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item label="快速预设" tooltip="选择后自动填充适配器类型、地址与配置">
              <Select
                placeholder="选择被测对象类型（如「我们的网页 Agent」/「OpenAI 兼容模型」）"
                onChange={applyPreset}
                options={presets.map((p) => ({ label: p.label, value: p.label }))}
              />
            </Form.Item>
          )}
          {(() => {
            const hint = presets.find((p) => p.adapter_type === watchedAdapterType)?.hint;
            return hint ? <Alert type="info" showIcon message={hint} style={{ marginBottom: 12 }} /> : null;
          })()}
          <Form.Item name="target_type" label="目标类型" rules={[{ required: true }]}>
            <Input placeholder="如 agent_http_api / cli_agent" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="version" label="版本" rules={[{ required: true }]}>
            <Input placeholder="v1.0.0" />
          </Form.Item>
          <Form.Item name="endpoint" label="接入地址">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="adapter_type" label="适配器类型" rules={[{ required: true }]}>
            <Select
              options={ADAPTER_TYPES.map((t) => ({ label: t, value: t }))}
              placeholder="选择适配器"
            />
          </Form.Item>
          <Form.Item
            name="adapter_config_json"
            label="适配配置 (JSON)"
            rules={[{ required: true, message: "请填写 JSON" }]}
          >
            <Input.TextArea
              className="ide-mono"
              rows={6}
              placeholder='{"auth_type":"bearer","timeout_ms":30000}'
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
