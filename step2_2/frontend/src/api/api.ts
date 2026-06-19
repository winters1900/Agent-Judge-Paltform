import { http } from "./client";
import type {
  AnalysisCompareResult,
  Dataset,
  DatasetSample,
  EvaluationMethod,
  EvaluationRun,
  EvaluationTarget,
  EvaluationTask,
  MetricDefinition,
  MetricResult,
  PageResponse,
  Report,
  RunSummary,
  SampleResult,
  TaskStatus,
  ToolCallLog,
  TraceRecord,
} from "./types";

/** 传给 axios 的 `signal`，用于取消仍在进行中的请求 */
export type ApiRequestOptions = { signal?: AbortSignal };

export async function listTargets(
  params?: {
    name?: string;
    target_type?: string;
    enabled?: boolean;
  },
  options?: ApiRequestOptions,
): Promise<EvaluationTarget[]> {
  const { data } = await http.get<EvaluationTarget[]>("/evaluation-targets", {
    params,
    signal: options?.signal,
  });
  return data;
}

export async function getTarget(id: number): Promise<EvaluationTarget> {
  const { data } = await http.get<EvaluationTarget>(`/evaluation-targets/${id}`);
  return data;
}

export async function createTarget(
  body: Omit<EvaluationTarget, "id" | "target_code" | "created_at" | "updated_at">,
): Promise<EvaluationTarget> {
  const { data } = await http.post<EvaluationTarget>("/evaluation-targets", body);
  return data;
}

export async function updateTarget(
  id: number,
  body: Partial<
    Omit<EvaluationTarget, "id" | "target_code" | "created_at" | "updated_at">
  >,
): Promise<EvaluationTarget> {
  const { data } = await http.put<EvaluationTarget>(`/evaluation-targets/${id}`, body);
  return data;
}

export async function deleteTarget(id: number): Promise<void> {
  await http.delete(`/evaluation-targets/${id}`);
}

export interface AdapterPreset {
  adapter_type: string;
  label: string;
  endpoint: string;
  needs_endpoint: boolean;
  config: Record<string, unknown>;
  hint: string;
}

/** 适配器配置预设（用于「新建目标」一键填充）。 */
export async function listTargetPresets(): Promise<AdapterPreset[]> {
  const { data } = await http.get<AdapterPreset[]>("/evaluation-targets/presets");
  return data;
}

export interface TargetTestResult {
  succeeded: boolean;
  output_text: string;
  error?: string | null;
  latency_ms: number;
  total_tokens: number;
  tool_calls: Array<Record<string, unknown>>;
}

/** 连通性测试：用一条示例 prompt 真实调用一次被测对象（不落库）。 */
export async function testTarget(body: {
  adapter_type: string;
  endpoint?: string | null;
  adapter_config: Record<string, unknown>;
  prompt?: string;
}): Promise<TargetTestResult> {
  // 连通性测试会真实调用一次 agent（编程 agent 一轮 ReAct 可能数分钟），
  // 故单独放宽超时，避免命中全局 60s 限制。
  const { data } = await http.post<TargetTestResult>("/evaluation-targets/test", body, {
    timeout: 200_000,
  });
  return data;
}

export async function listTasks(
  params?: {
    name?: string;
    status?: TaskStatus;
    page?: number;
    page_size?: number;
  },
  options?: ApiRequestOptions,
): Promise<PageResponse<EvaluationTask>> {
  const { data } = await http.get<PageResponse<EvaluationTask>>("/evaluation-tasks", {
    params,
    signal: options?.signal,
  });
  return data;
}

export async function getTask(id: number, options?: ApiRequestOptions): Promise<EvaluationTask> {
  const { data } = await http.get<EvaluationTask>(`/evaluation-tasks/${id}`, {
    signal: options?.signal,
  });
  return data;
}

export async function createTask(body: {
  name: string;
  description?: string | null;
  target_id: number;
  target_type: string;
  target_version: string;
  dataset_id: number;
  evaluation_method_config?: string[];
  metric_config?: Record<string, unknown>;
  run_config?: Record<string, unknown>;
  status?: TaskStatus;
}): Promise<EvaluationTask> {
  const { data } = await http.post<EvaluationTask>("/evaluation-tasks", body);
  return data;
}

export async function updateTask(
  id: number,
  body: Partial<{
    name: string;
    description: string | null;
    target_id: number;
    target_type: string;
    target_version: string;
    dataset_id: number;
    evaluation_method_config: string[];
    metric_config: Record<string, unknown>;
    run_config: Record<string, unknown>;
    status: TaskStatus;
  }>,
): Promise<EvaluationTask> {
  const { data } = await http.put<EvaluationTask>(`/evaluation-tasks/${id}`, body);
  return data;
}

export async function deleteTask(id: number): Promise<void> {
  await http.delete(`/evaluation-tasks/${id}`);
}

export async function listRuns(
  params?: {
    task_id?: number;
    status?: string;
    page?: number;
    page_size?: number;
  },
  options?: ApiRequestOptions,
): Promise<PageResponse<EvaluationRun>> {
  const { data } = await http.get<PageResponse<EvaluationRun>>("/evaluation-runs", {
    params,
    signal: options?.signal,
  });
  return data;
}

export async function getRun(id: number, options?: ApiRequestOptions): Promise<EvaluationRun> {
  const { data } = await http.get<EvaluationRun>(`/evaluation-runs/${id}`, {
    signal: options?.signal,
  });
  return data;
}

export async function createRun(body: {
  run_code: string;
  task_id: number;
  status?: string;
  progress?: number;
  summary?: string | null;
}): Promise<EvaluationRun> {
  const { data } = await http.post<EvaluationRun>("/evaluation-runs", body);
  return data;
}

/** 一键发起评测：为任务创建一次运行并立即后台执行。 */
export async function runTask(taskId: number): Promise<EvaluationRun> {
  const { data } = await http.post<EvaluationRun>(`/evaluation-tasks/${taskId}/run`);
  return data;
}

/** 触发一个已创建（queued）运行的实际执行。 */
export async function startRun(id: number): Promise<{ run_id: number; status: string; message: string }> {
  const { data } = await http.post(`/evaluation-runs/${id}/start`);
  return data;
}

export async function cancelRun(id: number): Promise<{ run_id: number; status: string; message: string }> {
  const { data } = await http.post(`/evaluation-runs/${id}/cancel`);
  return data;
}

export async function pauseRun(id: number): Promise<{ run_id: number; status: string; message: string }> {
  const { data } = await http.post(`/evaluation-runs/${id}/pause`);
  return data;
}

export async function resumeRun(id: number): Promise<{ run_id: number; status: string; message: string }> {
  const { data } = await http.post(`/evaluation-runs/${id}/resume`);
  return data;
}

export async function retryRun(id: number): Promise<{ run_id: number; status: string; message: string }> {
  const { data } = await http.post(`/evaluation-runs/${id}/retry`);
  return data;
}

export async function getRunSummary(id: number, options?: ApiRequestOptions): Promise<RunSummary> {
  const { data } = await http.get<RunSummary>(`/evaluation-runs/${id}/summary`, {
    signal: options?.signal,
  });
  return data;
}

export async function listSampleResults(
  runId: number,
  options?: ApiRequestOptions,
): Promise<SampleResult[]> {
  const { data } = await http.get<SampleResult[]>(`/evaluation-runs/${runId}/samples`, {
    signal: options?.signal,
  });
  return data;
}

export async function listDatasets(
  params?: {
    name?: string;
    status?: string;
    page?: number;
    page_size?: number;
  },
  options?: ApiRequestOptions,
): Promise<PageResponse<Dataset>> {
  const { data } = await http.get<PageResponse<Dataset>>("/datasets", {
    params,
    signal: options?.signal,
  });
  return data;
}

export async function getDataset(id: number, options?: ApiRequestOptions): Promise<Dataset> {
  const { data } = await http.get<Dataset>(`/datasets/${id}`, { signal: options?.signal });
  return data;
}

export async function createDataset(body: {
  dataset_code: string;
  name: string;
  description?: string | null;
  source_type: string;
  version: string;
  status: string;
}): Promise<Dataset> {
  const { data } = await http.post<Dataset>("/datasets", body);
  return data;
}

export async function deleteDataset(id: number): Promise<void> {
  await http.delete(`/datasets/${id}`);
}

export async function listDatasetSamples(
  datasetId: number,
  params?: { page?: number; page_size?: number },
  options?: ApiRequestOptions,
): Promise<PageResponse<DatasetSample>> {
  const { data } = await http.get<PageResponse<DatasetSample>>(
    `/datasets/${datasetId}/samples`,
    { params, signal: options?.signal },
  );
  return data;
}

export async function createDatasetSample(
  datasetId: number,
  body: {
    sample_code: string;
    sample_type: string;
    input_payload: Record<string, unknown>;
    expected_output?: Record<string, unknown> | null;
    reference_context?: Record<string, unknown> | null;
    ground_truth?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<DatasetSample> {
  const { data } = await http.post<DatasetSample>(`/datasets/${datasetId}/samples`, body);
  return data;
}

export async function importDatasetSamples(
  datasetId: number,
  samples: Array<{
    sample_code: string;
    sample_type: string;
    input_payload: Record<string, unknown>;
    expected_output?: Record<string, unknown> | null;
    reference_context?: Record<string, unknown> | null;
    ground_truth?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }>,
): Promise<DatasetSample[]> {
  const { data } = await http.post<DatasetSample[]>(`/datasets/${datasetId}/samples/import`, {
    samples,
  });
  return data;
}

export async function deleteDatasetSample(datasetId: number, sampleId: number): Promise<void> {
  await http.delete(`/datasets/${datasetId}/samples/${sampleId}`);
}

export async function listMethods(options?: ApiRequestOptions): Promise<EvaluationMethod[]> {
  const { data } = await http.get<EvaluationMethod[]>("/evaluation-methods", {
    signal: options?.signal,
  });
  return data;
}

export async function listMetrics(
  params?: {
    page?: number;
    page_size?: number;
  },
  options?: ApiRequestOptions,
): Promise<PageResponse<MetricDefinition>> {
  const { data } = await http.get<PageResponse<MetricDefinition>>("/metrics", {
    params,
    signal: options?.signal,
  });
  return data;
}

export async function createMetric(body: {
  metric_code: string;
  name: string;
  metric_type: string;
  dimension: string;
  description?: string | null;
  calc_mode: string;
  config_schema?: Record<string, unknown> | null;
  enabled?: boolean;
}): Promise<MetricDefinition> {
  const { data } = await http.post<MetricDefinition>("/metrics", body);
  return data;
}

export async function listRunMetrics(
  runId: number,
  options?: ApiRequestOptions,
): Promise<MetricResult[]> {
  const { data } = await http.get<MetricResult[]>(`/evaluation-runs/${runId}/metrics`, {
    signal: options?.signal,
  });
  return data;
}

export async function listTraces(
  runId: number,
  params?: { sample_id?: number; page?: number; page_size?: number },
  options?: ApiRequestOptions,
): Promise<PageResponse<TraceRecord>> {
  const { data } = await http.get<PageResponse<TraceRecord>>(
    `/evaluation-runs/${runId}/traces`,
    { params, signal: options?.signal },
  );
  return data;
}

export async function listToolCalls(
  runId: number,
  params?: { sample_id?: number; page?: number; page_size?: number },
  options?: ApiRequestOptions,
): Promise<PageResponse<ToolCallLog>> {
  const { data } = await http.get<PageResponse<ToolCallLog>>(
    `/evaluation-runs/${runId}/tool-calls`,
    { params, signal: options?.signal },
  );
  return data;
}

export async function listReports(runId: number, options?: ApiRequestOptions): Promise<Report[]> {
  const { data } = await http.get<Report[]>(`/evaluation-runs/${runId}/reports`, {
    signal: options?.signal,
  });
  return data;
}

export async function exportRunReport(
  runId: number,
  report_format = "pdf",
): Promise<Report> {
  const { data } = await http.post<Report>(`/evaluation-runs/${runId}/export`, {
    report_format,
  });
  return data;
}

export async function compareAnalysis(
  body: {
    task_ids: number[];
    metric_keys: string[];
  },
  options?: ApiRequestOptions,
): Promise<AnalysisCompareResult> {
  const { data } = await http.post<AnalysisCompareResult>("/analysis/compare", body, {
    signal: options?.signal,
  });
  return data;
}

export async function listAnalyses(params?: {
  page?: number;
  page_size?: number;
}): Promise<PageResponse<AnalysisCompareResult>> {
  const { data } = await http.get<PageResponse<AnalysisCompareResult>>("/analysis", { params });
  return data;
}
