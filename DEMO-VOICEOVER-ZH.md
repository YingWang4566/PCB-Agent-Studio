# CircuitMind 一分钟中英双语配音稿

## 使用说明

- 总时长：`00:00–01:00`，只演示 `board-conflict.json` 一个案例。
- 中文和英文按相同时间段对应；正式成片建议只选择一种语言配音，另一种作为字幕或备用稿。
- 语气专业、克制、清晰。配音比鼠标动作晚约 `0.3–0.5 秒`。

## 分段稿

### 00:00–00:05｜产品是什么 / What It Is

**中文**：CircuitMind 理解 PCB 工程意图，把自然语言转换成结构化约束。

**English**: CircuitMind understands PCB engineering intent and converts natural language into structured constraints.

### 00:05–00:10｜完整流程 / The Workflow

**中文**：导入板文件，输入指令，流式解析，输出目标、约束和优先级。

**English**: Import the board, enter the instruction, stream the analysis, and output targets, constraints, and priorities.

### 00:10–00:16｜导入板文件 / Import the Board

**中文**：系统读取器件、网络、铜层和板级上下文。

**English**: The system reads components, nets, copper layers, and board-level context.

### 00:16–00:27｜现场输入 / Live Input

**中文**：现场输入一个问题：最短路径跨过平面分割，绕行增加长度和过孔，应该先保证什么？

**English**: We enter a real question: the shortest path crosses a plane split, while routing around it adds length and vias. What should come first?

### 00:27–00:31｜运行解锁 / Run Unlocks

**中文**：文件和指令准备好后，运行按钮才会解锁。

**English**: The Run button unlocks only when the board and instruction are ready.

### 00:31–00:43｜流式解析 / Streaming Analysis

**中文**：系统判断任务，提取对象，编译约束，最后给出优先级；结果按顺序流式生成。

**English**: The system identifies the task, extracts targets, compiles constraints, and determines the priority. Results stream in sequence.

### 00:43–00:52｜结果与效果 / Result and Value

**中文**：这是 PCIE_RX1 的约束冲突判断：先保证信号完整性和连续回流，再优化长度和过孔。

**English**: This is a constraint-conflict decision for PCIE_RX1: preserve signal integrity and continuous return first, then optimize length and vias.

### 00:52–00:58｜证据图 / Evidence Map

**中文**：证据图把结果映射回板卡，展示判断依据，不是实际走线结果。

**English**: The evidence map links the result back to the board. It shows the reasoning evidence, not an actual routed result.

### 00:58–01:00｜总结 / Closing

**中文**：一句工程描述，就这样变成可审查的结构化意图。

**English**: One engineering description becomes structured intent that can be reviewed and acted on.

## 中文连续朗读版

CircuitMind 理解 PCB 工程意图，把自然语言转换成结构化约束。导入板文件，输入指令，流式解析，输出目标、约束和优先级。系统读取器件、网络、铜层和板级上下文。现场输入一个问题：最短路径跨过平面分割，绕行增加长度和过孔，应该先保证什么？文件和指令准备好后，运行按钮才会解锁。系统判断任务，提取对象，编译约束，最后给出优先级；结果按顺序流式生成。这是 PCIE_RX1 的约束冲突判断：先保证信号完整性和连续回流，再优化长度和过孔。证据图把结果映射回板卡，展示判断依据，不是实际走线结果。一句工程描述，就这样变成可审查的结构化意图。

## English Continuous Read

CircuitMind understands PCB engineering intent and converts natural language into structured constraints. Import the board, enter the instruction, stream the analysis, and output targets, constraints, and priorities. The system reads components, nets, copper layers, and board-level context. We enter a real question: the shortest path crosses a plane split, while routing around it adds length and vias. What should come first? The Run button unlocks only when the board and instruction are ready. The system identifies the task, extracts targets, compiles constraints, and determines the priority. Results stream in sequence. This is a constraint-conflict decision for PCIE_RX1: preserve signal integrity and continuous return first, then optimize length and vias. The evidence map links the result back to the board. It shows the reasoning evidence, not an actual routed result. One engineering description becomes structured intent that can be reviewed and acted on.
