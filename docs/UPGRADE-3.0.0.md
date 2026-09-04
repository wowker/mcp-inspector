# MCP Inspector 3.0.0 升级规划：自治测试设计 Agent

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Proposed；进入实施前需要确认 Provider、数据共享和自治调用策略 |
| 目标版本 | `3.0.0` |
| 当前代码版本 | `2.0.1` |
| 当前数据库基线 | migrations 001–018；实施前重新确认下一编号 |
| 更新日期 | 2026-09-04 |
| 适用范围 | AI Provider、Authoring MCP Server、连接运行时、场景编排、测试套件、SQLite、Web UI、发布产物 |
| 实施计划 | [`../tasks/upgrade-3.0.0-plan.md`](../tasks/upgrade-3.0.0-plan.md) |
| 任务清单 | [`../tasks/upgrade-3.0.0-todo.md`](../tasks/upgrade-3.0.0-todo.md) |

> 本规划继承 `AUTOMATED-TESTING-1.5.0.md`、`UPGRADE-2.0.0.md` 和
> `FRONTEND-DEVELOPMENT-STANDARDS.md` 的身份、安全、迁移、UI 与验证约束。
> 它取代 `tasks/ai-test-generation-plan.md` 中“仅依据 Tool 元数据生成一次性 Proposal”
> 作为 3.0.0 的主方向；该旧计划保留为无执行权限模式的设计参考。

## 1. 产品目标

面向已经拥有 MCP Server 的开发者和测试人员，把测试设计压缩为两个用户动作：

1. 配置 MCP 连接，并将连接声明为允许自治测试的测试或沙箱环境。
2. 用自然语言描述业务流程和期望结果。

之后由内置 Agent 自主完成：

- 发现并理解可用 MCP Tools；
- 规划业务步骤和覆盖方向；
- 代理调用真实 MCP Tools，观察实际响应；
- 从前一步响应组装后续参数并记录数据来源；
- 生成输入、固定参数、提取器、映射、转换、断言、轮询、失败和清理策略；
- 编译为现有确定性场景与测试套件；
- 在同一受控环境中回放验证并进行有界修正；
- 原子保存为默认禁用的测试定义。

用户在生成过程中不需要逐步批准、填写 JSONPath、配置变量或调整调度。自治不等于无限权限：权限在连接配置和生成启动时一次性确定，Agent 不能扩大范围。

## 2. 问题定义

**How might we** 让只了解业务目标的 MCP 开发者获得可重复、可审计、可维护的场景测试，而无需理解每个 Tool 的真实响应结构和编排语法，同时不让模型绕过连接身份、安全策略和确定性测试执行器？

用户雇佣这个能力完成的核心工作不是“帮我写 JSON”，而是：

> “替我探索这组 MCP Tools 如何共同完成业务流程，并把探索结果交付为以后不依赖 AI 也能稳定执行的自动化测试。”

## 3. 方向评估与结论

| 方向 | 用户价值 | 可行性 | 主要风险 | 结论 |
|---|---:|---:|---|---|
| 只把 Tool Schema 发给模型 | 中 | 高 | 无法验证真实响应和隐式业务约束 | 保留为离线降级模式 |
| 将全部业务 Tools 直接无约束暴露给模型 | 高 | 中 | 权限过大、无法审计、生产副作用 | 拒绝 |
| 每次 Tool 调用都要求人工确认 | 中 | 高 | 不满足零配置、无人值守目标 | 仅用于非测试环境，不是主流程 |
| 受控 Authoring MCP Server + 自治 Agent | 高 | 中 | Agent 状态机、来源追踪和清理复杂 | **3.0.0 推荐方向** |
| 让 AI 直接生成并执行脚本工作流 | 高 | 中 | 不确定执行、注入和维护风险 | 不作为主编排模型 |

推荐架构的差异化不在“接入了大模型”，而在于它能够把一次有状态的真实 MCP 探索，自动沉淀成脱离模型也能重放的确定性测试资产。

## 4. 目标用户体验

### 4.1 连接配置

连接仍以稳定 `connectionId` 隔离认证和运行状态。新增连接级自治测试策略：

```ts
interface AutonomousTestingPolicy {
  mode: "DISABLED" | "READ_ONLY" | "SANDBOX";
  allowWriteTools: boolean;
  allowDestructiveTools: boolean;
  requireCleanup: boolean;
  maxToolCalls: number;
  maxDurationMs: number;
  maxModelTurns: number;
}
```

推荐默认值：

- 新连接为 `DISABLED`；
- 用户明确声明测试/沙箱连接后可选 `SANDBOX`；
- `allowDestructiveTools` 默认关闭；
- 开启完全自治即构成对当前连接和策略范围的一次性授权，不在每次调用时重复询问；
- 生产或未知环境只能使用 `READ_ONLY`，无法完成写流程时明确失败，不悄悄扩大权限。

### 4.2 创建测试

用户选择连接并输入：

```text
创建订单，等待订单变为 READY，校验商品和数量，最后删除测试订单。
同时覆盖数量为 0 和不存在商品的错误场景。
```

点击“自治生成”后，页面只展示权威进度：发现工具、规划、探索、编译、回放、保存。除取消外不需要中途输入。

### 4.3 完成结果

成功后直接得到默认禁用的测试资产：

```text
测试套件：订单完整流程
├── 创建订单并等待 READY
├── 数量为 0 时创建失败
├── 不存在商品时创建失败
└── 订单清理验证
```

结果页显示生成摘要、已创建定义、回放状态、清理状态、调用次数和非敏感警告，并可打开现有场景/套件编辑器。正式定时运行和启用测试仍是独立动作。

## 5. 总体架构

```text
Web UI / REST API
        │
        ▼
Autonomous Test Generation Service
        │ owns job, budget, state and lifecycle
        ├──────────────► AI Provider Adapter
        │                  │ tool-call decisions
        │                  ▼
        └──────────────► Authoring MCP Client
                           │ in-process MCP transport
                           ▼
                    Authoring MCP Server
                           │ policy + validation + trace
                           ▼
                    ConnectionRuntime.callTool
                           │ exact connectionId
                           ▼
                    User MCP Server

Exploration trace + provenance graph
        ▼
Deterministic Scenario Compiler
        ▼
Existing Scenario Runner / Suite Services
        ▼
Bounded replay → atomic save
```

### 5.1 为什么内部仍使用 MCP

内置 Agent 不直接调用 `ConnectionRuntime`。它作为 MCP Host，通过 Authoring MCP Client 调用一个受控的 Authoring MCP Server。这样可以：

- 用 Tool Schema 明确模型可采取的动作；
- 统一内部模型 Provider 和未来外部 AI Host 的接入契约；
- 在单一网关实施连接隔离、参数校验、预算、审计和脱敏；
- 对每次模型动作保留协议级结果和稳定错误码；
- 测试时使用假的 Agent 与假的下游 MCP Server 独立验证。

3.0.0 默认只启用进程内 MCP transport，不开放公网或局域网 Authoring endpoint。外部 AI Host 接入需要独立认证、授权和部署设计，不能复用浏览器 session token 草率开放。

### 5.2 控制面与数据面

- **控制面**：生成任务、Agent 状态、预算、策略、模型回合、编译、回放、保存。
- **数据面**：通过既有连接运行时进行的真实 `tools/list` 和 `tools/call`。
- **持久化测试面**：现有 TestCase、Scenario、Suite、Execution 服务，是最终权威模型。

三者不得合并成一个“万能 Agent Service”。Authoring Server 不能直接写测试表；保存只能经过确定性编译与原子 Apply 服务。

## 6. Agent 执行模型

### 6.1 状态机

```text
QUEUED
  → DISCOVERING
  → PLANNING
  → EXPLORING
  → SYNTHESIZING
  → VALIDATING
  → REPLAYING
  → SAVING
  → COMPLETED

VALIDATING/REPLAYING → REPAIRING → VALIDATING

活动状态 → CANCELLED
活动状态 → FAILED
活动状态 → BUDGET_EXHAUSTED
活动状态 → INTERRUPTED
活动状态 → CLEANUP_FAILED
```

- 状态转换使用 compare-and-set；终态不可重新打开。
- 同一项目默认最多一个活动自治任务。
- 服务重启将活动任务置为 `INTERRUPTED`，不会自动重复结局未知的外部 Tool 调用或计费模型请求。
- 修正最多 2 轮；每轮必须减少阻塞问题，否则立即结束。

### 6.2 Agent 回合

```ts
interface AgentTurnRequest {
  systemInstruction: string;
  businessGoal: string;
  toolDefinitions: AuthoringToolDefinition[];
  messages: AgentMessage[];
  remainingBudget: AgentBudget;
}

type AgentTurnResult =
  | { kind: "TOOL_CALLS"; calls: AgentToolCall[]; usage: TokenUsage }
  | { kind: "FINAL"; summary: string; usage: TokenUsage };
```

Provider Adapter 只负责模型协议、Tool Calling、取消、超时、usage 和错误归一化。它不拥有业务权限、不解析连接、不调用真实 Tool、不保存测试。

### 6.3 系统指令职责

系统指令告诉 Agent：

- 目标是产出可重复的测试资产，不是仅完成一次业务操作；
- 必须使用来源引用表达步骤依赖，禁止把探索得到的动态 ID 写死；
- 优先用查询 Tool 发现有效前置数据；
- 写操作必须生成清理策略；
- 不确定条件应产生诊断而非伪造成功；
- 只有 Authoring MCP Tools 可用。

系统指令不是安全边界。Tool 网关、运行时 Schema、连接策略和服务端预算才是安全边界。

## 7. Authoring MCP Server 契约

Authoring MCP Server 暴露固定的小型工具集，而不是把所有下游 Tool 名称动态注册为顶层能力。

### 7.1 `testing.list_tools`

返回当前生成会话被授权连接内的 Tool 别名、名称、描述摘要、annotations 和 schema hash。分页且有数量/字节限制。

### 7.2 `testing.describe_tool`

返回一个 Tool 的脱敏完整输入/输出 Schema、允许调用级别和已知风险。Tool 描述和 Schema 被标记为不可信数据。

### 7.3 `testing.call_tool`

```ts
interface AuthoringCallToolRequest {
  toolAlias: string;
  fixedArguments: JsonObject;
  bindings: AuthoringArgumentBinding[];
  purpose: "DISCOVERY" | "SETUP" | "ACTION" | "POLL" | "CLEANUP";
  idempotencyKey: string;
}

type AuthoringValueSource =
  | { kind: "CALL_RESULT"; callId: string; source: "RESULT" | "ERROR"; path: string }
  | { kind: "GENERATED_INPUT"; name: string }
  | { kind: "ENVIRONMENT"; scope: "PROJECT" | "SERVER"; name: string }
  | { kind: "LITERAL"; value: JsonValue };

interface AuthoringArgumentBinding {
  source: AuthoringValueSource;
  targetPath: string;
  isRequired: boolean;
}
```

服务端先解析 bindings、构造最终参数、按目标 Tool input schema 校验，然后通过当前会话绑定的准确 `connectionId` 调用 `ConnectionRuntime.callTool`。

响应包含：

```ts
interface AuthoringCallToolResult {
  callId: string;
  status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  sanitizedResult: JsonValue | null;
  resultShape: JsonObject | null;
  redactions: number;
  truncation: { isTruncated: boolean; originalBytes: number | null };
  diagnostics: AuthoringDiagnostic[];
}
```

`UNKNOWN` 表示超时、断连或进程中断后无法确认外部副作用是否发生。除非 Tool 被代码判定为只读且幂等，否则 Agent 不能自动重复该调用。

### 7.4 `testing.inspect_call`

读取当前会话内的单次调用摘要、脱敏响应片段、参数来源和错误；不允许跨会话、跨项目或读取原始认证信息。

### 7.5 `testing.compile_draft`

接收目的化 Proposal AST 和引用过的 `callId`，生成内存中的场景/套件候选。它不写数据库，也不接受持久 ID、enabled 状态或 SQL/脚本命令。

### 7.6 `testing.validate_draft`

通过共享 Zod Schema、Tool snapshot、场景语义、参数 Schema、变量顺序、JSONPath 和限制检查候选定义，返回稳定的 blocking issues 与 warnings。

### 7.7 `testing.replay_draft`

通过现有 Scenario Runner 在同一连接和环境配置集上执行一次有界回放，生成正常 Test Execution/Run 关联。是否可回放由策略和副作用分析决定，不允许 Agent 切换连接。

### 7.8 `testing.finish_generation`

声明 Agent 已完成设计。Orchestrator 会重新执行独立校验，不能相信模型声称的“已验证”。通过后才进入保存阶段。

## 8. 来源图与参数编排

### 8.1 调用记录

```ts
interface AuthoringInvocation {
  id: string;
  generationId: string;
  sequence: number;
  toolAlias: string;
  purpose: AuthoringCallToolRequest["purpose"];
  fixedArguments: JsonObject;
  bindings: AuthoringArgumentBinding[];
  resolvedArgumentsDigest: string;
  sanitizedResult: JsonValue | null;
  resultDigest: string | null;
  status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  runId: string | null;
  startedAt: string;
  completedAt: string | null;
}
```

真实动态值不作为场景定义来源。编译器依赖 bindings 构造来源图：

```text
call-1 $.data.orderId
        │
        ├──► call-2 $.orderId
        └──► call-3 $.orderId
```

### 8.2 编译规则

`CALL_RESULT` 来源被编译为：

1. 来源步骤上的 response extractor；
2. 稳定、无冲突的变量名；
3. 目标步骤上的 variable mapping；
4. 必要时直接编译为现有 `STEP_RESPONSE` mapping，选择必须确定且可测试。

`GENERATED_INPUT` 被编译为场景输入或 setup 步骤，不能简单冻结探索值。`ENVIRONMENT` 保留变量引用，不能把解析值写入定义。

### 8.3 任意参数转换

优先使用固定参数、路径映射和确定性声明式转换。无法表达的对象重组、数组映射或类型转换可使用 3.0 的 step-local `argumentTransform`：

- 仅在 QuickJS 沙箱执行；
- 无网络、文件系统、Node API、Tool 调用和环境写入；
- 输入只能来自显式 bindings；
- 输出必须是有界 `JsonObject`；
- 有 CPU、内存、深度、节点数和字节限制；
- AI 生成的 transform 必须通过静态拒绝规则、沙箱预览和至少一次回放；
- transform 代码和 digest 进入测试 revision，运行时不再调用 AI。

## 9. 确定性场景编译器

编译器必须独立于模型 Provider，并完成：

1. 只解析严格 Proposal AST，拒绝未知字段和超限内容。
2. 将 Tool alias 映射为会话快照中的准确 `connectionId + toolName`。
3. 用服务端生成的 UUID 替换所有临时 proposal/call 标识。
4. 根据来源图生成 inputs、extractors、mappings 和 transforms。
5. 根据业务目标、Schema 和探索证据生成并校验 assertions。
6. 将重复读取及状态变化编译为有上限的 polling policy。
7. 将 setup/action/cleanup 轨迹放入正确阶段。
8. 校验前向引用、循环依赖、类型兼容、JSONPath 和 Tool snapshot 漂移。
9. 强制所有新 Test Case `isEnabled: false`。
10. 生成 Scenario、Suite 和 review summary；模型不能提供持久 ID 或 enabled 状态。

编译输出必须对相同输入、注入 ID/时间源时保持确定性。

## 10. 自动回放、修正和保存

### 10.1 回放

- 使用现有 Scenario Runner、Run、Workflow、脱敏和取消链路。
- 回放前重新检查 Tool snapshot、connectionId、环境配置集和 Agent policy。
- 回放产生新数据时必须使用独立生成输入，不能重用探索阶段的动态 ID。
- 回放结束后始终尝试 cleanup；取消和失败也不能跳过已具备前置条件的 cleanup。

### 10.2 修正

只把有界、脱敏的失败诊断交给 Agent，例如：

- 参数 Schema 不兼容；
- JSONPath 未命中；
- 断言失败；
- 轮询超限；
- 清理步骤缺失。

Agent 可以修改 Proposal 后重新编译，但不能：

- 扩大 Tool/连接范围；
- 增加权限；
- 重试结局未知的非幂等调用；
- 修改已保存测试；
- 超过剩余模型、调用或时间预算。

### 10.3 保存

保存是 Orchestrator 的服务端动作，不是模型 Tool 的直接数据库写入：

- 接受 generationId、编译 digest 和最终 Tool snapshot hashes；
- 在一个 SQLite transaction 中创建 Test Cases、revisions、targets、Suite 和 members；
- 全部定义默认禁用；
- 同一成功 generation 只能 Apply 一次，重复同一请求返回原结果；
- 任一写入失败完整回滚；
- 保存完成不会自动创建计划任务或再次执行。

## 11. Provider 与凭证

```ts
interface AiProviderConfig {
  id: string;
  projectId: string;
  kind: "HOSTED_PROVIDER_V1";
  name: string;
  model: string;
  credential: {
    kind: "PROJECT_SECRET_VARIABLE";
    variableName: string;
  };
  isEnabled: boolean;
}
```

- 3.0 首个 Provider 使用固定可信 HTTPS endpoint；自定义 URL 延后。
- 数据库只保存 secret variable 引用，不保存解析后的 Key。
- Key 只在服务端发起请求前解析，不进入 Prompt、URL、普通日志、Toast、导出或浏览器存储。
- 模型响应、usage 和 request ID 均视为不可信第三方数据。
- Provider SDK 不是默认选择；若直接 HTTP 能满足 Tool Calling、取消、超时和 usage，则避免新增宽泛依赖。

## 12. 数据模型

实施前重新检查最新 migration。当前观察到的最大版本是 018，以下编号仅为占位：

### 下一 migration A：Provider 与自治策略

- `ai_provider_configs`
- `connection_autonomous_testing_policies`

策略严格绑定 `project_id + connection_id`，不能按 URL、域名或 Server 名称复用。

### 下一 migration B：生成会话与调用轨迹

- `autonomous_test_generations`
- `autonomous_test_generation_events`
- `autonomous_test_invocations`
- `autonomous_test_apply_results`

持久化规则：

- generation 使用稳定 ID、幂等键、请求 hash、状态和预算计数；
- 只存脱敏、有界的请求/响应摘要和来源关系；
- 不存 Authorization header、OAuth token、环境变量解析值、完整系统 Prompt 或 Provider 原始响应；
- 原始 Tool response 只存在当前进程内的有界缓冲，任务结束即释放；
- 生成轨迹默认保留 7 天，可由用户删除；创建的正式测试按现有规则保留；
- 项目删除级联 AI 配置和生成记录；默认导出全部排除。

## 13. REST API

Provider：

```text
GET    /api/projects/:projectId/ai/providers
POST   /api/projects/:projectId/ai/providers
PATCH  /api/projects/:projectId/ai/providers/:providerId
DELETE /api/projects/:projectId/ai/providers/:providerId
POST   /api/projects/:projectId/ai/providers/:providerId/checks
```

自治策略：

```text
GET   /api/projects/:projectId/connections/:connectionId/autonomous-testing-policy
PATCH /api/projects/:projectId/connections/:connectionId/autonomous-testing-policy
```

生成任务：

```text
POST /api/projects/:projectId/autonomous-test-generations
GET  /api/projects/:projectId/autonomous-test-generations/:generationId
GET  /api/projects/:projectId/autonomous-test-generations/:generationId/events
POST /api/projects/:projectId/autonomous-test-generations/:generationId/cancellation
```

启动请求：

```ts
interface StartAutonomousTestGenerationRequest {
  idempotencyKey: string;
  providerId: string;
  connectionId: string;
  environmentProfileId: string | null;
  businessGoal: string;
  constraints?: {
    maxGeneratedCases?: number;
    requestedCoverage?: Array<
      "HAPPY_PATH" | "EXPECTED_ERROR" | "BOUNDARY" | "POLLING" | "CLEANUP"
    >;
  };
}
```

客户端不提交 Tool Schema、Tool 响应、连接凭证、Agent policy 结果或编译后的定义。服务端从 `projectId + connectionId` 权威加载。

状态改变接口必须真正兑现幂等语义：相同 key 和 body 返回同一任务，不同 body 返回冲突；在途重复不会启动第二个 Agent。

## 14. 稳定错误码

- `AI_PROVIDER_NOT_CONFIGURED`
- `AI_CREDENTIAL_UNAVAILABLE`
- `AI_PROVIDER_UNAVAILABLE`
- `AUTONOMOUS_TESTING_DISABLED`
- `AUTONOMOUS_POLICY_VIOLATION`
- `AUTONOMOUS_CONNECTION_UNAVAILABLE`
- `AUTONOMOUS_GENERATION_CONFLICT`
- `AUTONOMOUS_GENERATION_LIMIT_REACHED`
- `AUTONOMOUS_GENERATION_CANCELLED`
- `AUTONOMOUS_GENERATION_INTERRUPTED`
- `AUTONOMOUS_BUDGET_EXHAUSTED`
- `AUTHORING_TOOL_NOT_ALLOWED`
- `AUTHORING_ARGUMENTS_INVALID`
- `AUTHORING_BINDING_UNRESOLVED`
- `AUTHORING_CALL_OUTCOME_UNKNOWN`
- `AUTHORING_RESPONSE_TOO_LARGE`
- `AI_AGENT_OUTPUT_INVALID`
- `AI_SCENARIO_COMPILATION_FAILED`
- `AI_SCENARIO_REPLAY_FAILED`
- `AI_SCENARIO_CLEANUP_FAILED`
- `AI_TEST_DESIGN_STALE`
- `AI_TEST_SAVE_CONFLICT`

Provider 响应正文、URL、stack、内部 Tool 参数和凭证不得成为用户可见错误。

## 15. 安全与隐私模型

### 15.1 信任边界

1. 用户业务描述进入本地 API。
2. 下游 MCP Tool 描述和 Schema 进入模型上下文。
3. 脱敏后的业务描述、Schema 和响应片段离开本地进程进入 Provider。
4. 模型 Tool Call 参数返回本地进程。
5. Authoring Server 代理真实业务调用并接收外部响应。
6. 编译结果在原子保存时进入正式测试定义。

每个边界都必须运行时校验。Prompt 中的文字不能替代授权。

### 15.2 STRIDE 与控制

| 风险 | 示例 | 必须控制 |
|---|---|---|
| Spoofing | Agent 伪造 connectionId/callId | 会话内 opaque alias、项目/连接 fence |
| Tampering | 模型篡改来源引用或快照 | digest、严格 Schema、服务端 alias map |
| Repudiation | 无法说明谁调用了写 Tool | generation/event/invocation 审计链 |
| Information disclosure | Tool 响应或凭证进入模型 | 最长优先 secret redactor、字段策略、截断、禁止原始日志 |
| Denial of service | 无限模型回合、Tool 调用或大响应 | token/turn/call/time/byte/concurrency 限额 |
| Elevation of privilege | Agent 选择未授权 Tool 或生产连接 | 连接级预授权、Tool allowlist、服务端策略检查 |

### 15.3 提示词注入

Tool 描述、Schema、Tool 响应和业务数据都可能包含“忽略之前指令”之类内容。控制措施：

- Agent 只有固定 Authoring MCP Tools；
- 所有 Tool 参数经过严格 Zod/Ajv 校验；
- alias、connectionId、权限和预算由服务端决定；
- 模型文本不会进入 `eval`、SQL、Shell、HTML、路径或 URL；
- QuickJS transform 是隔离的数据变换能力，不具有 Authoring Tool 权限；
- `finish_generation` 后仍由独立编译器重新校验。

### 15.4 副作用和未知结果

- 只读 Tool 可以按策略自动重试。
- 写 Tool 必须有 Agent 级幂等键；若下游不支持幂等，调用超时后状态为 `UNKNOWN`。
- 未知的非幂等调用不能自动重试；任务终止并尝试已知安全的 cleanup。
- destructive Tool 只能在连接策略预授权后使用，默认禁止。
- `requireCleanup` 时，没有可编译清理路径的写流程不能标记为验证通过。
- 连接策略不能由 Agent、Tool 描述或 Tool 响应修改。

### 15.5 默认预算

| 项目 | 默认值 | 硬上限 |
|---|---:|---:|
| 单项目活动任务 | 1 | 1 |
| 模型回合 | 20 | 40 |
| 真实 Tool 调用 | 20 | 50 |
| 写 Tool 调用 | 8 | 20 |
| 修正轮次 | 1 | 2 |
| 任务时长 | 5 分钟 | 10 分钟 |
| 单次 Tool 响应发送给模型 | 128 KiB | 512 KiB |
| 总响应上下文 | 512 KiB | 2 MiB |
| 生成场景 | 5 | 10 |
| 每场景步骤 | 12 | 30 |

## 16. UI 设计

遵循现有高密度工作台规范，不新增聊天气泡式 UI。

### 16.1 设置

- Provider 设置只选择项目 secret variable 引用，不输入或回显原始 API Key。
- 连接设置增加明确的“自治测试环境”策略，解释 AI 可能真实调用 Tool。
- `SANDBOX` 与 destructive 授权必须是清晰的独立选择，不使用预选勾选框。

### 16.2 生成入口

- 自动化测试页提供“自治生成”。
- 表单仅要求连接、环境配置集和业务描述；高级覆盖约束可折叠。
- 启动前显示一次数据共享、调用预算和连接策略摘要。
- 启动后无需逐次确认，支持取消。

### 16.3 进度与结果

- 用阶段时间线展示权威状态，不展示模型思维链。
- 展示 Tool 调用名称、目的、状态和脱敏摘要，不显示 secret 和完整敏感正文。
- 完成后展示创建的场景/套件、验证状态、清理状态和可操作警告。
- 项目切换、页面离开和取消必须 fence 晚到响应；后台任务由服务端继续或取消的规则必须明确。
- 全部文案支持 `zh-CN` 和 `en-US`，键盘、焦点、Escape、长文本和深浅主题通过测试。

## 17. 可观测性

需要记录不含敏感数据的事件：

- generation 状态转换和耗时；
- Provider 调用次数、token usage、timeout/cancel；
- Authoring Tool 调用类别、延迟、结果状态和截断计数；
- 编译错误类别、回放结果、修正次数；
- cleanup 成功/失败；
- 创建的场景/套件数量。

禁止记录完整 Prompt、完整 Tool 参数/响应、解析后的环境变量、认证 Header 和 Provider Key。

## 18. MVP 范围

### 必须交付

- 一个支持 MCP Tool Calling 的官方托管 Provider Adapter。
- 进程内 Authoring MCP Server 和 Client。
- 单连接、单环境配置集的自治探索。
- 真实 Tool 调用、响应观察和来源绑定。
- 场景 inputs、steps、mappings、extractors、assertions、polling、cleanup。
- 多场景和一个或多个测试套件。
- 有界自动回放和最多两次修正。
- 原子保存默认禁用定义。
- Provider/策略设置、业务描述、进度和结果 UI。
- SQLite migrations、双语、测试、打包和发布验证。

### 不做

- 不支持一个生成任务跨多个连接编排；先证明连接隔离和单连接闭环。
- 不开放远程 Authoring MCP endpoint 给任意第三方 AI Host。
- 不允许生产连接无人值守写入。
- 不自动启用、定时或持续运行生成的测试。
- 不长期保存原始 Tool 响应、完整 Prompt 或模型思维链。
- 不做向量库、RAG、跨项目记忆或基于用户数据训练。
- 不自动修改、覆盖或删除已有测试。
- 不允许无限“修到成功”。
- 不把真实返回值批量冻结为断言或固定参数。

## 19. 关键假设与验证

### Must be true

- [ ] Agent 能在 20 个代表性 MCP Tool catalog 中，至少 80% 的目标生成结构合法的单连接场景。使用固定业务目标 corpus 和 fake servers 验证。
- [ ] 来源引用足以把探索调用还原为不含动态硬编码的场景。对 ID、数组、嵌套对象和分页案例做 golden tests。
- [ ] 自动 cleanup 能在取消、失败和成功路径清除测试数据。使用故障注入验证。
- [ ] 连接级预授权能实现无人值守，同时不跨项目、连接或 Tool 范围。使用同 URL 不同认证连接的对抗测试验证。

### Should be true

- [ ] 一次回放加一次修正能使至少 70% 的有效业务目标达到通过或“有解释的不可验证”状态。
- [ ] 发送脱敏响应形状和有界片段不会显著降低生成质量。
- [ ] 生成的场景经人工查看后，大多数不需要重写步骤依赖。

### Might be true

- [ ] 多连接编排可以复用相同 Authoring 协议扩展。
- [ ] 外部 AI Host 可以安全复用 Authoring MCP Server。
- [ ] 历史失败可用于后续自动补充覆盖，但不属于 3.0 MVP。

## 20. 成功指标

- 首次从业务描述到已保存测试的中位时间小于 5 分钟。
- 代表性 corpus 的场景编译成功率至少 80%。
- 已成功探索的动态字段硬编码率为 0。
- 跨项目、跨连接、跨会话调用成功数为 0。
- secret fixture 进入 Provider 捕获请求的数量为 0。
- 未经连接策略允许的写/破坏性 Tool 调用数为 0。
- 任务取消后继续产生的新外部调用数为 0。
- 原子保存故障产生的半成品定义数为 0。

## 21. 实施前批准项

- [ ] 选择首个支持 Tool Calling 的官方托管 Provider 和固定 endpoint。
- [ ] 批准向 Provider 发送业务描述、选定 Tool 元数据和脱敏响应片段。
- [ ] 批准连接级 `SANDBOX` 自治策略及其一次性授权语义。
- [ ] 确认 destructive Tools 默认关闭，只能在连接策略显式开启。
- [ ] 确认正式测试默认禁用，不自动定时执行。
- [ ] 确认原始响应仅进程内短暂保留，脱敏轨迹默认保留 7 天。
- [ ] 确认 AI 生成 QuickJS 参数转换必须经过沙箱预览和回放。
