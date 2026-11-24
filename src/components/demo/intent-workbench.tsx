"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  FileJsonIcon,
  LayersIcon,
  LockIcon,
  PlusIcon,
  PlayIcon,
  RouteIcon,
  SparklesIcon,
  TargetIcon,
  UploadIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  BENCHMARK_METRICS,
  CATEGORY_METRICS,
  INTENT_DEMO_SAMPLES,
  TASK_LABELS,
  type IntentDemoSample,
  type IntentPrediction,
} from "@/lib/intent-demo-data";
import { cn } from "@/lib/utils";

type AnalysisPhase = "ready" | "running" | "done";
type BoardParsePhase = "empty" | "parsing" | "ready" | "error";

type BoardFileContext = {
  name: string;
  sizeLabel: string;
  format: string;
  boardId: string;
  componentCount: number | null;
  netCount: number | null;
  layerCount: number | null;
  packageHint: string | null;
};

const DEFAULT_SAMPLE = INTENT_DEMO_SAMPLES[0];
const STREAM_STAGES = [
  { label: "意图分类", detail: "识别主要任务" },
  { label: "对象抽取", detail: "定位器件与网络" },
  { label: "约束编译", detail: "生成设计规则" },
  { label: "优先级决策", detail: "解释工程取舍" },
] as const;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseBoardFile(file: File, source: string): BoardFileContext {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "file";
  const stem = file.name.replace(/\.[^.]+$/, "");
  let componentCount: number | null = null;
  let netCount: number | null = null;
  let layerCount: number | null = null;
  let packageHint: string | null = null;
  let boardId = stem.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase() || "IMPORTED_BOARD";

  if (extension === "json") {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const nestedBoard = parsed.board && typeof parsed.board === "object" ? parsed.board as Record<string, unknown> : {};
    const metadata = { ...parsed, ...nestedBoard };
    componentCount = toPositiveNumber(metadata.component_count ?? metadata.componentCount ?? metadata.components);
    netCount = toPositiveNumber(metadata.net_count ?? metadata.netCount ?? metadata.nets);
    layerCount = toPositiveNumber(metadata.layer_count ?? metadata.layerCount ?? metadata.layers);
    packageHint = typeof metadata.package === "string" ? metadata.package : null;
    boardId = typeof metadata.board_id === "string"
      ? metadata.board_id
      : typeof metadata.id === "string"
        ? metadata.id
        : boardId;
  } else if (extension === "kicad_pcb") {
    componentCount = (source.match(/\(footprint\s/g) ?? []).length || (source.match(/\(module\s/g) ?? []).length || null;
    netCount = new Set(Array.from(source.matchAll(/\(net\s+\d+\s+"([^"]+)"\)/g), (match) => match[1])).size || null;
    layerCount = new Set(Array.from(source.matchAll(/\([^\s()]+\s+"?([^"\s()]+\.Cu)"?/g), (match) => match[1])).size || null;
  } else {
    componentCount = new Set(Array.from(source.matchAll(/\b(?:U|R|C|L|J|Q|D)\d+\b/g), (match) => match[0])).size || null;
    netCount = new Set(Array.from(source.matchAll(/\b(?:NET|PCIE|USB|LVDS|DP|ADC|DCO)_[A-Z0-9_+-]+\b/gi), (match) => match[0])).size || null;
    const layerMatch = source.match(/(?:layer_count|layers|铜层|层数)\s*[:=：]?\s*(\d+)/i);
    layerCount = layerMatch ? Number(layerMatch[1]) : null;
  }

  return {
    name: file.name,
    sizeLabel: formatFileSize(file.size),
    format: extension === "kicad_pcb" ? "KiCad PCB" : extension.toUpperCase(),
    boardId,
    componentCount,
    netCount,
    layerCount,
    packageHint,
  };
}

const CUSTOM_CONSTRAINTS: Record<string, { code: string; label: string }> = {
  connectivity: { code: "same_net_connectivity", label: "同网连通" },
  avoid: { code: "avoid_unrelated_nets", label: "避免误连" },
  layer: { code: "layer_or_via_strategy", label: "层选择与过孔策略" },
  pair: { code: "pair_routing", label: "成对布线" },
  impedance: { code: "impedance_control", label: "阻抗控制" },
  length: { code: "length_matching", label: "等长控制" },
  plane: { code: "reference_plane_continuity", label: "参考平面连续" },
  via: { code: "minimize_via_count", label: "减少过孔" },
  coupling: { code: "ac_coupling_cap_placement", label: "AC 耦合位置" },
  stub: { code: "avoid_excess_stub", label: "避免过长 Stub" },
};

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set(Array.from(text.matchAll(pattern), (match) => match[1]))];
}

function buildCustomSample(question: string): IntentDemoSample {
  const isConflict = /冲突|应该先|先保|优先|取舍|不能同时|参考平面分割/.test(question);
  const isDifferential = /差分|PCIE|PCIe|USB|LVDS|P\/N|_P\b|_N\b/i.test(question);
  const isFanout = /扇出|焊盘口|起步段|带出来一点/.test(question);
  const isEscape = /逃线|阵列外|密集区|外侧通道/.test(question);
  const isRepair = /没接|未接|断点|断着|补线|缺口|修复/.test(question);

  const taskCode = isConflict
    ? "constraint_conflict_judgment"
    : isDifferential
      ? "differential_pair_routing"
      : isFanout
        ? "bga_fanout"
        : isEscape
          ? "bga_escape_routing"
          : isRepair
            ? "bga_pin_connection_repair"
            : "single_net_routing";

  const components = uniqueMatches(question, /\b(U\d+)\b/gi).map((item) => item.toUpperCase());
  const component = components[0] ?? "未识别";
  const pinPattern = component === "未识别"
    ? /$^/g
    : new RegExp(`${component}[.的\\s/]*(?:pin\\s*)?([A-Z]{1,2}\\d+)`, "gi");
  const pins = [
    ...new Set([
      ...uniqueMatches(question, pinPattern),
      ...uniqueMatches(question, /\/([A-Z]{1,2}\d+)\b/g),
    ]),
  ];
  const nets = [
    ...new Set(
      Array.from(
        question.matchAll(/\b((?:NET|PCIE|USB|LVDS|DP|ADC|DCO)_[A-Z0-9_+-]+)\b/gi),
        (match) => match[1].toUpperCase(),
      ),
    ),
  ];

  const constraintKeys = new Set<string>();
  if (isRepair || /连通|连接/.test(question)) constraintKeys.add("connectivity");
  if (/避开|误连|无关网络|间距|拥挤/.test(question)) constraintKeys.add("avoid");
  if (/换层|层切换|过孔/.test(question)) constraintKeys.add("layer");
  if (isDifferential) constraintKeys.add("pair");
  if (/阻抗/.test(question)) constraintKeys.add("impedance");
  if (/等长|长度|时序/.test(question)) constraintKeys.add("length");
  if (/参考平面|回流/.test(question)) constraintKeys.add("plane");
  if (/少打孔|减少过孔|少过孔/.test(question)) constraintKeys.add("via");
  if (/AC\s*耦合|耦合电容|电容位置/i.test(question)) constraintKeys.add("coupling");
  if (/stub|残桩/i.test(question)) constraintKeys.add("stub");
  if (constraintKeys.size === 0) {
    constraintKeys.add("connectivity");
    constraintKeys.add("avoid");
  }

  const constraints = [...constraintKeys].map((key) => CUSTOM_CONSTRAINTS[key]);
  const signalIntegrityFirst = isDifferential || /阻抗|参考平面|回流|时序/.test(question);
  const priorityCodes = signalIntegrityFirst
    ? ["signal_integrity_first"]
    : ["connectivity_first"];
  if (/少打孔|减少过孔|少过孔/.test(question)) priorityCodes.push("minimize_via_count");

  const prediction: IntentPrediction = {
    taskCode,
    taskLabel: TASK_LABELS[taskCode],
    intent: isConflict
      ? "识别工程约束之间的冲突，并给出可执行的优先级。"
      : `识别为${TASK_LABELS[taskCode]}任务，并抽取目标对象与工程约束。`,
    component,
    pins,
    nets,
    constraintCodes: constraints.map((item) => item.code),
    constraints: constraints.map((item) => item.label),
    priorityCodes,
    priorities: priorityCodes.map((code) =>
      code === "signal_integrity_first"
        ? "信号完整性优先"
        : code === "minimize_via_count"
          ? "减少过孔"
          : "连通性优先",
    ),
    reason: signalIntegrityFirst
      ? "输入包含高速链路或回流路径线索，应先保证差分成对、阻抗与参考平面连续，再优化路径长度和过孔数量。"
      : "输入的首要目标是恢复或建立正确的网络连接，同时避免与无关网络发生误连。",
    latencySeconds: null,
    attempts: 1,
    schemaValid: true,
    corePassed: true,
    coreMetric: "演示解析",
  };

  return {
    id: "LOCAL_DEMO_INPUT",
    shortLabel: "自定义输入",
    title: "本地规则预览",
    question,
    questionType: "自定义指令",
    source: "本地演示解析",
    difficulty: "中等",
    board: {
      id: "IMPORTED_BOARD",
      component,
      package: "导入板文件",
      pinCount: null,
      layerCount: null,
      signalLayers: null,
      traceWidth: null,
      clearance: null,
      evidence: "由当前板文件与工程指令动态定位",
      variant: isConflict ? "conflict" : isDifferential ? "differential" : "repair",
    },
    prediction,
  };
}

function BoardSignalMap({ sample }: Readonly<{ sample: IntentDemoSample }>) {
  const isDifferential = sample.board.variant !== "repair";
  const isConflict = sample.board.variant === "conflict";
  const pads = Array.from({ length: 48 }, (_, index) => ({
    x: 56 + (index % 8) * 18,
    y: 43 + Math.floor(index / 8) * 18,
  }));

  return (
    <div className="signal-map" aria-label="目标对象与风险区域示意图">
      <div className="signal-map__legend">
        <span><i className="legend-dot legend-dot--target" />目标网络</span>
        <span><i className="legend-dot legend-dot--context" />邻近网络</span>
        {isConflict ? <span><i className="legend-dot legend-dot--risk" />平面分割</span> : null}
      </div>
      <svg viewBox="0 0 520 240" role="img" aria-label={`${sample.title} 的板级证据定位`}>
        <defs>
          <pattern id="micro-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M16 0H0V16" fill="none" stroke="rgba(189,244,85,.09)" strokeWidth="0.7" />
          </pattern>
          <filter id="signal-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x="1" y="1" width="518" height="238" rx="15" fill="#07100e" stroke="rgba(189,244,85,.18)" />
        <rect x="1" y="1" width="518" height="238" rx="15" fill="url(#micro-grid)" />
        {isConflict ? (
          <path d="M318 18L369 18L333 222L282 222Z" fill="rgba(255,126,77,.08)" stroke="rgba(255,126,77,.5)" strokeDasharray="5 6" />
        ) : null}
        <rect x="39" y="26" width="164" height="130" rx="13" fill="rgba(10,29,25,.92)" stroke="rgba(189,244,85,.24)" />
        {pads.map((pad, index) => {
          const active = isDifferential ? index === 19 || index === 20 : index === 26;
          return (
            <circle
              key={`${pad.x}-${pad.y}`}
              cx={pad.x}
              cy={pad.y}
              r={active ? 5.6 : 3.2}
              fill={active ? "#bdf455" : "rgba(177,211,193,.24)"}
              stroke={active ? "rgba(189,244,85,.55)" : "transparent"}
              strokeWidth="5"
            />
          );
        })}
        <text x="50" y="177" fill="rgba(224,235,226,.62)" fontSize="10" letterSpacing="1.8">{sample.board.component} · BGA ARRAY</text>
        {isDifferential ? (
          <>
            <path d="M128 79C213 70 229 58 293 77S408 138 485 94" fill="none" stroke="#bdf455" strokeWidth="3" filter="url(#signal-glow)" />
            <path d="M128 97C209 89 229 77 291 95S405 156 486 112" fill="none" stroke="#56dfc2" strokeWidth="3" />
            <circle cx="128" cy="79" r="4" fill="#bdf455" />
            <circle cx="128" cy="97" r="4" fill="#56dfc2" />
            <circle cx="486" cy="94" r="5" fill="#07100e" stroke="#bdf455" strokeWidth="2" />
            <circle cx="486" cy="112" r="5" fill="#07100e" stroke="#56dfc2" strokeWidth="2" />
            <text x="365" y="72" fill="#dfe9df" fontSize="10">{sample.prediction.nets[0] ?? "目标网络 P"}</text>
            <text x="365" y="137" fill="#9cb3a7" fontSize="10">{sample.prediction.nets[1] ?? "目标网络 N"}</text>
            {isConflict ? (
              <path d="M128 79C235 123 292 157 480 194" fill="none" stroke="rgba(255,126,77,.9)" strokeWidth="2" strokeDasharray="7 7" />
            ) : null}
          </>
        ) : (
          <>
            <path d="M110 97C210 103 252 180 404 165" fill="none" stroke="#bdf455" strokeWidth="2.6" strokeDasharray="7 6" filter="url(#signal-glow)" />
            <circle cx="110" cy="97" r="6" fill="#bdf455" />
            <circle cx="404" cy="165" r="7" fill="#07100e" stroke="#bdf455" strokeWidth="2" />
            <text x="418" y="169" fill="#dfe9df" fontSize="11">TP104.1</text>
            <path d="M248 32C274 77 309 84 352 66S418 46 482 57" fill="none" stroke="rgba(86,223,194,.35)" strokeWidth="2" />
            <path d="M238 201C278 147 343 128 482 137" fill="none" stroke="rgba(86,223,194,.28)" strokeWidth="2" />
          </>
        )}
        <text x="283" y="218" fill="rgba(224,235,226,.4)" fontSize="9" letterSpacing="1.4">EVIDENCE MAP · NO ROUTE GENERATED</text>
      </svg>
      <div className="signal-map__note">
        <CircleDotIcon />
        <span>仅标注目标、连通关系与风险区域；当前模块不生成实际布线。</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, index }: Readonly<{ label: string; value: string; detail: string; index: number }>) {
  return (
    <div className="metric-card" style={{ animationDelay: `${80 + index * 60}ms` }}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function OutputPill({ children, tone = "default" }: Readonly<{ children: React.ReactNode; tone?: "default" | "priority" }>) {
  return <span className={cn("output-pill", tone === "priority" && "output-pill--priority")}>{children}</span>;
}

export function IntentWorkbench() {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<IntentDemoSample>(DEFAULT_SAMPLE);
  const [phase, setPhase] = useState<AnalysisPhase>("ready");
  const [boardPhase, setBoardPhase] = useState<BoardParsePhase>("empty");
  const [boardContext, setBoardContext] = useState<BoardFileContext | null>(null);
  const [outputStage, setOutputStage] = useState(0);
  const [streamedIntent, setStreamedIntent] = useState("");
  const [runLogs, setRunLogs] = useState<string[]>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => {
    timerRef.current.forEach(clearTimeout);
  }, []);

  function updateDraft(value: string) {
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    setDraft(value);
    setPhase("ready");
    setOutputStage(0);
    setStreamedIntent("");
    setRunLogs([]);
  }

  function clearCurrentCase() {
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    if (uploadRef.current) uploadRef.current.value = "";
    setBoardPhase("empty");
    setBoardContext(null);
    setDraft("");
    setPhase("ready");
    setOutputStage(0);
    setStreamedIntent("");
    setRunLogs([]);
    setJsonOpen(false);
  }

  function beginNewAnalysis() {
    clearCurrentCase();
    toast.success("新的分析已准备", { description: "请导入下一块 PCB 板文件。" });
  }

  function runAnalysis() {
    if (boardPhase !== "ready" || !boardContext) {
      toast.error("请先导入并解析 PCB 板文件");
      return;
    }
    if (!draft.trim()) {
      toast.error("请先输入 PCB 工程指令");
      return;
    }
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    const exact = INTENT_DEMO_SAMPLES.find((sample) => sample.question.trim() === draft.trim());
    const parsedResult = exact ?? buildCustomSample(draft.trim());
    const nextResult: IntentDemoSample = {
      ...parsedResult,
      id: `LOCAL_${boardContext.boardId}`,
      source: boardContext.name,
      board: {
        ...parsedResult.board,
        id: boardContext.boardId,
        package: boardContext.packageHint ?? `${boardContext.format} · ${boardContext.layerCount ?? "?"} 铜层`,
        layerCount: boardContext.layerCount,
      },
    };

    setResult(nextResult);
    setPhase("running");
    setOutputStage(0);
    setStreamedIntent("");
    setRunLogs(["[00:00.08] 指令已进入 PCB-Intent-v2"]);
    setJsonOpen(false);

    function schedule(delay: number, action: () => void) {
      timerRef.current.push(setTimeout(action, delay));
    }

    schedule(480, () => {
      setOutputStage(1);
      setRunLogs((logs) => [...logs, "[00:00.48] primary_task_type 已识别"]);
    });

    const intentCharacters = Array.from(nextResult.prediction.intent);
    for (let length = 3; length <= intentCharacters.length + 2; length += 3) {
      schedule(560 + length * 18, () => {
        setStreamedIntent(intentCharacters.slice(0, Math.min(length, intentCharacters.length)).join(""));
      });
    }

    schedule(1680, () => {
      setOutputStage(2);
      setRunLogs((logs) => [...logs, "[00:01.68] component / pins / nets 已定位"]);
    });
    schedule(2820, () => {
      setOutputStage(3);
      setRunLogs((logs) => [...logs, `[00:02.82] ${nextResult.prediction.constraints.length} 项约束已编译`]);
    });
    schedule(3980, () => {
      setOutputStage(4);
      setRunLogs((logs) => [...logs, "[00:03.98] 冲突优先级与解释已生成"]);
    });
    schedule(4720, () => {
      startTransition(() => {
        setPhase("done");
        setStreamedIntent(nextResult.prediction.intent);
      });
      setRunLogs((logs) => [...logs, "[00:04.72] schema validation passed"]);
      toast.success("板级上下文与工程指令解析完成");
    });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const input = event.currentTarget;
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    setBoardPhase("parsing");
    setBoardContext(null);
    setDraft("");
    setPhase("ready");
    setOutputStage(0);
    setStreamedIntent("");
    setRunLogs([]);
    setJsonOpen(false);

    try {
      const source = await file.text();
      const parsedBoard = parseBoardFile(file, source);
      input.value = "";
      timerRef.current.push(setTimeout(() => {
        setBoardContext(parsedBoard);
        setBoardPhase("ready");
        toast.success(`${file.name} 板级上下文解析完成`);
        textareaRef.current?.focus();
      }, 820));
    } catch {
      input.value = "";
      setBoardPhase("error");
      toast.error("板文件读取失败", { description: "请检查 JSON 格式或改用 KiCad PCB / TXT 文件。" });
    }
  }

  const hasInstruction = draft.trim().length > 0;
  const canRun = boardPhase === "ready" && hasInstruction && phase !== "running";

  async function copyResult() {
    const payload = {
      primary_task_type: result.prediction.taskCode,
      secondary_task_types: [],
      intent: result.prediction.intent,
      target_component: result.prediction.component,
      target_pins: result.prediction.pins,
      target_nets: result.prediction.nets,
      constraint_tags: result.prediction.constraintCodes,
      priority_tags: result.prediction.priorityCodes,
      reason: result.prediction.reason,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success("结构化结果已复制");
  }

  const jsonPayload = JSON.stringify(
    {
      primary_task_type: result.prediction.taskCode,
      secondary_task_types: [],
      intent: result.prediction.intent,
      target_component: result.prediction.component,
      target_pins: result.prediction.pins,
      target_nets: result.prediction.nets,
      constraint_tags: result.prediction.constraintCodes,
      priority_tags: result.prediction.priorityCodes,
      reason: result.prediction.reason,
    },
    null,
    2,
  );

  return (
    <div className="intent-app">
      <div className="intent-app__glow" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CircuitMind 首页">
          <span className="brand__mark"><RouteIcon /></span>
          <span className="brand__name">CIRCUIT<span>MIND</span></span>
          <span className="brand__edition">PCB AI / 01</span>
        </a>
        <nav className="module-nav" aria-label="产品模块">
          <button className="module-nav__item module-nav__item--active" type="button">
            <SparklesIcon />
            意图理解
          </button>
          <button
            className="module-nav__item"
            type="button"
            onClick={() => toast.info("Agent Routing 接口已预留", { description: "实际 Trace 生成由后续模块接入。" })}
          >
            <RouteIcon />
            Agent 布线
            <LockIcon className="module-nav__lock" />
          </button>
        </nav>
        <div className="system-state">
          <span className="system-state__pulse" />
          <span><strong>LOCAL DEMO</strong>板文件与指令现场解析</span>
        </div>
      </header>

      <main id="top" className="product-shell">
        <section className="hero">
          <div className="hero__copy">
            <div className="eyebrow"><ZapIcon /> PCB INTENT COMPILER · PUBLIC DEMO</div>
            <h1>把工程师的自然语言，<br /><span>编译成可执行设计约束。</span></h1>
            <p>
              先读取 PCB 板文件，再理解工程师现场输入的自然语言，从真实板级上下文中识别目标对象、约束与冲突优先级。
            </p>
          </div>
          <div className="hero__flow" aria-label="处理流程">
            {["导入板文件", "输入指令", "流式解析", "结构化输出"].map((label, index) => (
              <div className="flow-node" key={label}>
                <span>0{index + 1}</span>
                <strong>{label}</strong>
                {index < 3 ? <ArrowRightIcon /> : <CheckIcon />}
              </div>
            ))}
          </div>
        </section>

        <section className="metrics-grid" aria-label="验证集评测指标">
          {BENCHMARK_METRICS.map((metric, index) => (
            <MetricCard key={metric.label} {...metric} index={index} />
          ))}
        </section>

        <section className="workbench-grid">
          <div className="command-panel panel-frame">
            <div className="panel-heading">
              <div>
                <span className="panel-index">INPUT / 01</span>
                <h2>板文件与工程指令</h2>
              </div>
              <span className="dataset-chip"><LayersIcon /> 3 STEP WORKFLOW</span>
            </div>

            <div className="input-steps" aria-label="演示输入步骤">
              <div className={cn(boardPhase === "ready" && "is-complete", boardPhase === "parsing" && "is-active")}>
                <span>{boardPhase === "ready" ? <CheckIcon /> : "01"}</span>
                <strong>导入板文件</strong>
              </div>
              <div className={cn(hasInstruction && "is-complete", boardPhase === "ready" && !hasInstruction && "is-active")}>
                <span>{hasInstruction ? <CheckIcon /> : "02"}</span>
                <strong>输入工程指令</strong>
              </div>
              <div className={cn(phase === "done" && "is-complete", canRun && "is-active")}>
                <span>{phase === "done" ? <CheckIcon /> : "03"}</span>
                <strong>运行流式解析</strong>
              </div>
            </div>

            <div className={cn("board-upload-card", `board-upload-card--${boardPhase}`)}>
              <input ref={uploadRef} type="file" accept=".kicad_pcb,.json,.txt,.brd,.pcb" hidden onChange={handleUpload} />
              <div className="board-upload-card__icon">
                {boardPhase === "parsing" ? <ActivityIcon className="spin-slow" /> : boardPhase === "ready" ? <CheckIcon /> : <UploadIcon />}
              </div>
              <div className="board-upload-card__copy">
                <span>STEP 01 · BOARD CONTEXT</span>
                <strong>
                  {boardPhase === "parsing" ? "正在读取板级结构…" : boardPhase === "ready" && boardContext ? boardContext.name : boardPhase === "error" ? "文件解析失败，请重新选择" : "导入 PCB 板文件"}
                </strong>
                <small>
                  {boardPhase === "ready" && boardContext
                    ? `${boardContext.format} · ${boardContext.sizeLabel} · 本地解析完成`
                    : "支持 .kicad_pcb / .json / .txt / .brd / .pcb，文件只在当前浏览器中读取"}
                </small>
              </div>
              <button type="button" onClick={() => uploadRef.current?.click()} disabled={boardPhase === "parsing"}>
                {boardPhase === "ready" ? "更换文件" : "选择文件"}
              </button>
            </div>

            {boardPhase === "ready" && boardContext ? (
              <div className="board-context-row stream-reveal" aria-label="已解析板级上下文">
                <div><CpuIcon /><span>器件数量<strong>{boardContext.componentCount ?? "待模型识别"}</strong></span></div>
                <div><TargetIcon /><span>网络数量<strong>{boardContext.netCount ?? "待模型识别"}</strong></span></div>
                <div><LayersIcon /><span>铜层 / BOARD ID<strong>{boardContext.layerCount ?? "?"} · {boardContext.boardId}</strong></span></div>
              </div>
            ) : null}

            <div className="prompt-box">
              <div className="prompt-box__meta">
                <span>STEP 02 · NATURAL LANGUAGE</span>
                <span>{boardContext?.name ?? "等待板文件"}</span>
                <span>{hasInstruction ? "指令已就绪" : "现场输入"}</span>
              </div>
              <textarea
                ref={textareaRef}
                aria-label="PCB 工程指令"
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    runAnalysis();
                  }
                }}
                placeholder={boardPhase === "ready" ? "请在这里现场输入 PCB 工程需求，例如：U5.N20 / U5.N21 的 PCIE_RX1_P / PCIE_RX1_N 如果跨过参考平面分割，应该先保证什么？" : "请先完成上方的板文件导入…"}
                disabled={boardPhase !== "ready" || phase === "running"}
                spellCheck={false}
              />
              <div className="prompt-box__counter">{draft.length} CHARS</div>
            </div>

            <div className={cn("command-actions", phase === "done" && "command-actions--complete")}>
              <button className="primary-action" type="button" onClick={runAnalysis} disabled={!canRun}>
                {phase === "running" ? <ActivityIcon className="spin-slow" /> : <PlayIcon />}
                {phase === "running"
                  ? "正在解析板级上下文与意图"
                  : phase === "done"
                    ? "重新运行本案例"
                  : boardPhase !== "ready"
                    ? "请先导入板文件"
                    : !hasInstruction
                      ? "请输入工程指令"
                      : "运行意图引擎"}
                <span>⌘ ↵</span>
              </button>
              {phase === "done" ? (
                <button className="secondary-action" type="button" onClick={beginNewAnalysis}>
                  <PlusIcon />
                  新建分析
                </button>
              ) : null}
            </div>
          </div>

          <div className={cn("output-panel panel-frame", phase === "running" && "output-panel--streaming")}>
            <div className="scan-line" aria-hidden="true" />
            <div className="panel-heading">
              <div>
                <span className="panel-index">OUTPUT / 02</span>
                <h2>结构化理解</h2>
              </div>
              <div className={cn("validation-badge", `validation-badge--${phase}`)}>
                {phase === "running" ? <ActivityIcon className="spin-slow" /> : phase === "done" ? <CheckIcon /> : <CircleDotIcon />}
                {phase === "running" ? `STREAMING · ${Math.max(8, outputStage * 25)}%` : phase === "done" ? "SCHEMA VALID" : "AWAITING RUN"}
              </div>
            </div>

            {phase === "ready" ? (
              <div className="output-empty">
                <div className="output-empty__icon"><SparklesIcon /></div>
                <span className="intent-kicker">RESULTS ARE INTENTIONALLY HIDDEN</span>
                <h3>{boardPhase !== "ready" ? "等待板文件" : !hasInstruction ? "等待工程指令" : "输入已就绪"}</h3>
                <p>
                  {boardPhase !== "ready"
                    ? "先导入一个板文件，系统会读取器件、网络与铜层等板级上下文。"
                    : !hasInstruction
                      ? "板级上下文已经准备好，请在左侧方框内现场输入本次工程需求。"
                      : "板文件与自然语言指令已齐备。点击运行后，结果才会按真实解析顺序逐块出现。"}
                </p>
                <div className="output-empty__sequence">
                  {STREAM_STAGES.map((stage, index) => (
                    <div key={stage.label}>
                      <span>0{index + 1}</span>
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </div>
                  ))}
                </div>
                <div className="output-empty__hint"><ArrowRightIcon /> {!canRun ? "完成左侧输入准备后即可运行" : "点击左侧「运行意图引擎」开始流式演示"}</div>
              </div>
            ) : (
              <>
                <div className="stream-progress" aria-label="解析进度">
                  <div className="stream-progress__track"><i style={{ width: `${phase === "done" ? 100 : Math.max(8, outputStage * 25)}%` }} /></div>
                  <div className="stream-progress__steps">
                    {STREAM_STAGES.map((stage, index) => {
                      const stageNumber = index + 1;
                      const isComplete = phase === "done" || outputStage > stageNumber;
                      const isActive = phase === "running" && outputStage === stageNumber;
                      return (
                        <div className={cn(isComplete && "is-complete", isActive && "is-active")} key={stage.label}>
                          <span>{isComplete ? <CheckIcon /> : `0${stageNumber}`}</span>
                          <strong>{stage.label}</strong>
                        </div>
                      );
                    })}
                  </div>
                  <div className="run-feed" aria-live="polite">
                    {runLogs.map((log) => <code key={log}>{log}</code>)}
                    {phase === "running" ? <i /> : null}
                  </div>
                </div>

                {outputStage >= 1 ? (
                  <div className="intent-result stream-reveal">
                    <div className="intent-result__lead">
                      <span className="intent-kicker">PRIMARY INTENT</span>
                      <h3>{result.prediction.taskLabel}</h3>
                      <code>{result.prediction.taskCode}</code>
                      <p>{streamedIntent}<span className={cn("typing-cursor", phase === "done" && "typing-cursor--done")} /></p>
                    </div>
                    <div className="run-verdict">
                      <span>{phase === "done" ? <CheckIcon /> : <ActivityIcon className="spin-slow" />}{phase === "done" ? "核心指标通过" : "正在生成"}</span>
                      <strong>{phase === "done" ? (result.prediction.latencySeconds === null ? "LOCAL" : `${result.prediction.latencySeconds.toFixed(3)}s`) : "LIVE"}</strong>
                      <small>{result.prediction.coreMetric}{result.prediction.attempts > 1 ? ` · ${result.prediction.attempts} 次请求` : ""}</small>
                    </div>
                  </div>
                ) : null}

                {outputStage >= 2 ? (
                  <div className="target-grid stream-reveal">
                    <div className="output-block">
                      <span className="output-block__label">TARGET COMPONENT</span>
                      <strong className="mono-value">{result.prediction.component}</strong>
                    </div>
                    <div className="output-block">
                      <span className="output-block__label">TARGET PINS</span>
                      <div className="pill-row">{result.prediction.pins.length > 0 ? result.prediction.pins.map((pin) => <OutputPill key={pin}>{pin}</OutputPill>) : <OutputPill>未在指令中识别</OutputPill>}</div>
                    </div>
                    <div className="output-block output-block--wide">
                      <span className="output-block__label">TARGET NETS</span>
                      <div className="pill-row">{result.prediction.nets.length > 0 ? result.prediction.nets.map((net) => <OutputPill key={net}>{net}</OutputPill>) : <OutputPill>未在指令中识别</OutputPill>}</div>
                    </div>
                  </div>
                ) : null}

                {outputStage >= 3 ? (
                  <div className="output-section stream-reveal">
                    <span className="output-block__label">COMPILED CONSTRAINTS · {result.prediction.constraints.length}</span>
                    <div className="constraint-list">
                      {result.prediction.constraints.map((constraint, index) => (
                        <div key={constraint}><span>0{index + 1}</span><strong>{constraint}</strong><CheckIcon /></div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {outputStage >= 4 ? (
                  <div className="stream-reveal">
                    <div className="priority-section">
                      <span className="output-block__label">DECISION PRIORITY</span>
                      <div className="pill-row">
                        {result.prediction.priorities.map((priority) => <OutputPill key={priority} tone="priority">{priority}</OutputPill>)}
                      </div>
                      <p>{result.prediction.reason}</p>
                    </div>

                    <div className="json-actions">
                      <button type="button" onClick={() => setJsonOpen((open) => !open)}><FileJsonIcon />{jsonOpen ? "收起 JSON" : "查看 JSON"}</button>
                      <button type="button" onClick={copyResult}><CopyIcon />复制结果</button>
                    </div>
                    {jsonOpen ? <pre className="json-preview">{jsonPayload}</pre> : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="evidence-grid">
          <div className="evidence-panel panel-frame">
            <div className="panel-heading panel-heading--compact">
              <div><span className="panel-index">EVIDENCE / 03</span><h2>板级证据定位</h2></div>
              <span className="evidence-id">{phase !== "ready" && outputStage >= 2 ? result.board.id : "AWAITING RESULT"}</span>
            </div>
            {phase !== "ready" && outputStage >= 2 ? (
              <div className="stream-reveal"><BoardSignalMap sample={result} /></div>
            ) : (
              <div className="evidence-empty">
                <TargetIcon />
                <strong>等待目标对象</strong>
                <span>解析出器件、管脚与网络后，这里才会同步定位板级证据。</span>
              </div>
            )}
          </div>

          <div className="benchmark-panel panel-frame">
            <div className="panel-heading panel-heading--compact">
              <div><span className="panel-index">VALIDATION / 04</span><h2>四类能力覆盖</h2></div>
              <span className="dataset-chip">V1.1 验收口径</span>
            </div>
            <div className="category-bars">
              {CATEGORY_METRICS.map((metric, index) => (
                <div className="category-row" key={metric.label}>
                  <div><span>0{index + 1}</span><strong>{metric.label}</strong><em>{metric.value}%</em></div>
                  <div className="category-track"><i style={{ width: `${metric.value}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="benchmark-footer">
              <div><ClockIcon /><span>模型<strong>PCB-Intent-v2</strong></span></div>
              <div><DatabaseIcon /><span>输入<strong>100 题 / 脱敏板级材料</strong></span></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>CIRCUITMIND · PCB INTENT INTELLIGENCE</span>
        <span>PUBLIC DEMO DATA · MODEL OUTPUT AUDITABLE</span>
      </footer>
    </div>
  );
}
