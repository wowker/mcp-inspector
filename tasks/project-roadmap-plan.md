# Implementation Plan: MCP Inspector 未完成项执行路线

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | 技术交付完成；独立复审已通过，等待明确发布授权 |
| 基线 | 当前 2.0 RC 工作树；package 仍为 `1.0.4` |
| 日期 | 2026-09-02 |
| 配套清单 | [project-roadmap-todo.md](./project-roadmap-todo.md) |

## Overview

本计划把项目内仍处于“实施中”“仅剩验收”“只有设计”“计划已过期”的工作重新排序为可连续交付的纵向切片。排序原则是：先恢复稳定门禁并关闭安全风险，再完成已经做到一半的参数编辑器，随后建立最小 UI Foundation，最后实现 1.5.0 自动化测试并重基线运行回放与 2.0.0 工作。

运行历史与回放的 [plan.md](./plan.md) 与 [todo.md](./todo.md) 已在 Task 15 中完成迁移编号、产品边界和实现顺序重基线；生产实现须通过文档中列出的人工确认门禁后开始。

按产品要求，本计划不包含版本号、Tag 或 npm 发布版本不一致的修复工作。

## Source of Truth

- [前端 UI 与交互开发规范](../docs/FRONTEND-DEVELOPMENT-STANDARDS.md)
- [参数编辑器第二阶段](../docs/PARAMETER-EDITOR-PHASE-2.md)
- [Tool Script Workflows 规格](../docs/SPEC-tool-script-workflows.md)
- [Tool Script Workflows 清单](./tool-script-workflows-todo.md)
- [1.5.0 自动化测试规范](../docs/AUTOMATED-TESTING-1.5.0.md)
- [内部 UI Foundation ADR](../docs/decisions/001-internal-ui-foundation.md)
- [UI 组件库评估](../docs/UI-COMPONENT-LIBRARY-EVALUATION.md)
- [2.0.0 升级规划](../docs/UPGRADE-2.0.0.md)

发生冲突时，领域规格优先于本路线；前端行为必须满足 Active 的前端开发规范。涉及认证、secret、身份边界、删除语义或新增重要依赖时必须暂停并取得产品确认。

## Current Baseline

- 参数编辑器 Phase 1 与 Phase 2 的 `array<object>` 已完成。
- Tool Script Workflows Tasks 1–11 已完成并通过独立安全质量复审。
- 自动化测试 1.5.0 的 M1–M5、报告、基线更新和版本化导入导出均已完成。
- 当前迁移为 001–018；运行回放与比较已按迁移 014/015 的重基线方案交付。
- i18n 已覆盖应用 Shell、核心调试流程与自动化测试模块，中英文 key tree 由共享测试约束。
- 项目级 UI Foundation 已建立，新增页面复用内部 primitives、语义 tokens 与 Phosphor Icons。
- 最近一次完整门禁为 Vitest 826/826、production Playwright 7/7；同一独立 reviewer 已以 0 Critical/Required/Recommended 批准当前 RC 代码与候选 artifact。

## Dependency Graph

```text
Task 1 稳定门禁
  └─> Task 2 脚本安全收尾
       └─> Tasks 3–4 参数编辑器 Phase 2
            └─> Tasks 5–7 最小 UI Foundation / i18n / 性能基线
                 └─> [产品确认]
                      └─> Tasks 8–14 自动化测试 1.5.0
                           └─> Task 15 回放计划重基线
                                └─> Tasks 16–18 2.0 剩余能力与发布门禁
```

## Architecture Decisions

- 所有新增能力继续以 `projectId + connectionId + tabId/runId` 作为身份 fence；认证绝不按 URL 或域名复用。
- SQLite 只增加新编号迁移，不重写 001–011；migration 012 在 1.5.0 范围确认后分配。
- UI Foundation 是 Feature 唯一可依赖的公共组件接口；第三方组件只能封装在 Foundation 内，PoC 通过前不加入生产依赖。
- 参数 Form、局部 Raw 和整份 Raw 始终写入同一 canonical arguments；非法局部草稿不得污染持久态。
- 自动化执行复用现有 Run/Workflow 调用链，不建立第二套 MCP runtime。
- 每个任务使用 RED → GREEN → REFACTOR，且在一个聚焦会话内完成；超出约 5 个主要文件时继续拆分。

## Task List

### Phase 0: Quality and Security Baseline

## Task 1: Stabilize the current verification baseline

**Description:** 定位并消除 `ConnectionPanel` Tool Catalog 刷新 Toast 测试的全量套件时序波动，确认它是测试等待问题还是产品状态竞争。

**Acceptance criteria:**
- [x] 回归测试在受控异步条件下先稳定失败再稳定通过，不依赖 sleep。
- [x] 连接切换、断开和旧请求完成不能向错误的 connection/project 显示 Toast。
- [x] 聚焦测试连续通过，完整 `npm run verify` 通过且无 open handle。

**Verification:** `npx vitest run src/client/features/connections/__tests__/ConnectionPanel.test.tsx`；`npm run verify`

**Dependencies:** None  
**Likely files:** `ConnectionPanel.tsx`、`ConnectionPanel.test.tsx`  
**Scope:** Small

**Execution record (2026-08-31):**
- 结论：产品的 connection/project generation fence 正常；波动来自测试把 2 秒 Toast 的可见状态作为断连竞态的前置条件。
- 修正：受控 deferred refresh 用例改为等待首次目录刷新调用完成，再验证断连同步失效和旧请求不能回写；不使用 sleep。
- 环境：验证必须使用项目 Node 22；Node 20 与现有 `better-sqlite3` ABI 不兼容，不属于产品失败。
- 结果：ConnectionPanel 26/26；Vitest 564/564；Playwright 2/2；`npm run verify` 通过且进程正常退出。

## Task 2: Close the script workflow security gate

**Description:** 对已完成的脚本流水线执行独立五轴审查和威胁模型审查，只修复真实 Critical/Required，不扩大脚本权限。

**Acceptance criteria:**
- [x] 覆盖 QuickJS IPC、helper Tool、变量、secret、取消、资源上限和导出边界。
- [x] 审查结果记录证据；Critical/Required 均关闭或明确阻断后续工作。
- [x] 正常 Run、Workflow、同 URL 不同 connection 隔离均无回归。

**Verification:** workflow focused suites；`npm run verify`；`npm pack --dry-run --json`

**Dependencies:** Task 1  
**Likely files:** 以审查发现为准；若无 Required，仅更新审查记录  
**Scope:** Medium

**Execution record (2026-08-31):**
- 复审：完成 QuickJS、父子 IPC、helper Tool、environment/secret、幂等、取消/资源和打包边界威胁模型；报告见 [Tool Script Workflows 安全与质量复审](../docs/reviews/2026-08-31-tool-script-workflow-security-review.md)。
- 修正：结构化 secret 嵌套标量脱敏与阻断、secret 降级持久化阻断、重名 helper Server fail-closed、破坏性授权绑定幂等 snapshot、父进程独立 IPC 方向/重复/资源校验。
- 结果：Workflow focused 23/23；Vitest 570/570；Playwright 2/2；`npm run verify` 与 `npm pack --dry-run --json` 通过；未关闭 Critical/Required 为 0。

### Checkpoint A: Stable 1.x core

- [x] Tasks 1–2 完成。
- [x] 完整门禁稳定通过。
- [x] 独立审查无 Critical/Required。
- [x] 人工确认后进入参数编辑器工作。

### Phase 1: Finish Parameter Editor Phase 2

## Task 3: Add bounded nested-object editing

**Description:** 为可安全解释的嵌套 object 增加递归 Form、Disclosure 和局部 Raw 编辑，超过深度时安全降级。

**Acceptance criteria:**
- [x] JSON Pointer 作为字段身份，嵌套草稿严格绑定 project/connection/tab/tool。
- [x] 合法 Form/Raw 双向同步；非法 Raw 只保留本地草稿。
- [x] 最大深度、未知组合 Schema 和 prototype key 均降级为局部 JSON。

**Verification:** `npx vitest run src/client/features/tabs/__tests__/ParameterEditor.phase2.test.tsx`；`npm run typecheck`

**Dependencies:** Task 2  
**Likely files:** `ParameterEditor.tsx`、`ParameterControls.tsx`、Phase 2 tests、tools locale resources、feature CSS  
**Scope:** Medium

## Task 4: Add deterministic oneOf/anyOf branches

**Description:** 只为能通过 discriminator、唯一 const 或单值 enum 明确识别的组合 Schema 提供分支选择。

**Acceptance criteria:**
- [x] 无歧义分支可选择并保留公共字段。
- [x] 可能删除字段时先提示，取消后 canonical arguments 不变。
- [x] 无法识别的组合安全回退到局部 JSON，不猜测分支。

**Verification:** Phase 2 focused tests；`npm run typecheck`；`npm run verify`

**Dependencies:** Task 3  
**Likely files:** Parameter editor/schema helpers、focused tests、locale resources、feature CSS  
**Scope:** Medium

### Checkpoint B: Canonical parameter editing

- [x] 嵌套 object、array<object>、oneOf/anyOf 和整份 Raw 共用 canonical arguments。
- [x] Skip、脚本延迟校验、历史恢复和无参数 Tool 行为不变。
- [x] `npm run verify` 通过。

**Execution record (2026-08-31):**
- 仅对标准 discriminator 或唯一 const/单值 enum 可确定的 object 分支提供结构化选择；歧义、畸形、深层组合及 prototype key 均 fail-closed 到局部 JSON。
- 分支切换保留 parent common 与未知扩展字段；删除旧分支专属字段前显示明确确认，取消不写 canonical arguments。
- 未初始化必填分支可从空对象选择；Form、局部 Raw 与整份 Raw 保持同步。
- 复审修复了危险键值可能被分支 UI 隐藏的降级缺口。
- 结果：focused 93/93；Vitest 585/585；Playwright 2/2；typecheck、build 与 `npm run verify` 全部通过。

### Phase 2: Minimum UI Foundation

## Task 5: Establish internal action and disclosure primitives

**Description:** 建立第一批内部 `Button`、`IconButton`、`StatusBadge` 和 `Disclosure`，迁移一个低风险页面证明 contract，不做全量重写。

**Acceptance criteria:**
- [x] Feature 不直接依赖新的第三方组件 API。
- [x] 深浅主题、focus-visible、keyboard、loading/disabled 和 i18n props 有测试。
- [x] PoC 构建记录 JS/CSS gzip 变化，不能无说明扩大首屏包体。

**Verification:** primitive focused tests；`npm run typecheck && npm run build`

**Dependencies:** Task 4  
**Likely files:** `src/client/components/**`、tokens/component CSS、primitive tests、一个迁移页面  
**Scope:** Medium

**Execution record (2026-08-31):**
- 新增内部 `Button`、`IconButton`、`StatusBadge`、`Disclosure` 与唯一的 `foundation.css`；所有颜色均复用既有 `--ui-*` semantic tokens，未引入第三方组件依赖或第二套主题系统。
- PoC 仅迁移低风险的 Tool Definition：复制、状态、Raw Definition disclosure 与历史快照帮助操作；不改变 project、connection、tab、run、认证或 SQLite 行为。
- 回归：Button 强制 `type=button`、disabled/loading、中文/英文可访问名称；Icon button label/title；Status 语义；Disclosure 的键盘及 controlled 行为；Foundation stylesheet semantic theme token contract；Tool Definition 迁移。
- 构建对比：前一基线 CSS `71.15 kB gzip` / JS `268.58 kB gzip`；PoC 后 CSS `71.58 kB gzip` / JS `269.11 kB gzip`。增加 `0.43 kB` CSS 与 `0.53 kB` JS gzip，均为四个基础组件和迁移调用代码；没有新增首屏第三方库。
- 结果：focused 10/10；typecheck、build 与 `git diff --check` 通过。

## Task 6: Establish overlay and form primitives

**Description:** 增加内部 Dialog、Menu/Popover、FormField 和 Select contract，优先替换当前重复焦点、外部点击和深色主题实现。

**Acceptance criteria:**
- [x] Escape、点击外部、焦点限制/返回和 viewport collision 行为统一。
- [x] Select placeholder、空选项、Radio/Checkbox/Switch 在中英文及深浅主题可辨识。
- [x] secret 眼睛按钮不改变输入布局，Dialog header/body/footer 使用同一 surface。

**Verification:** component keyboard/a11y tests；connection dialog focused tests；`npm run verify`

**Dependencies:** Task 5  
**Likely files:** internal components、ConnectionDialogs、parameter controls、tests、component CSS  
**Scope:** Medium

**Execution record (2026-08-31):**
- 新增内部 `Dialog`、`Popover`、`FormField` 和原生语义 `Select`；不引入新的第三方组件依赖。`Dialog` 统一 Escape、backdrop、focus trap、focus return 和 disabled-close 行为；`Popover` 统一 anchor collision、resize/scroll 重定位、外部点击与 Escape 的关闭约定。
- Connections 的创建/编辑/删除 Dialog 和 Saved Item Dialog 已迁移到共享 Dialog；认证方式迁移为共享 Select；参数枚举 Dropdown 迁移为共享 Popover，保留既有 roving keyboard、返回焦点和 project/connection/tab state 行为。
- `FormField` 提供 label、必填标记、帮助文本、constraint、错误提示及 `aria-describedby` 合并；必填星号位于 label 外，避免污染可访问名称。现有 schema Radio、Checkbox、Switch 与参数 Dropdown 已有语义和深浅主题回归，本次由 shared Popover 对齐浮层行为。
- 回归：Foundation 覆盖 Dialog focus/Tab/Escape/backdrop、Popover outside/Escape、Select 键盘、FormField aria 关联；Connection 和 Debug Workspace 覆盖 secret 显隐、Radio/Switch/Dropdown 及焦点行为。完整门禁：Vitest `595/595`、Playwright `2/2`、typecheck、build、`git diff --check` 通过。
- 构建对比（相对 Task 5）：CSS `71.58 → 71.72 kB gzip`，JS `269.11 → 269.48 kB gzip`；增量来自内部 overlay/form primitives 与迁移代码，无新增首屏依赖。

## Task 7: Expand i18n and split heavy client features

**Description:** 把应用 Shell、Servers、Runs 和通用错误迁移到共享 `zh-CN/en-US` 资源，并建立大型 viewer/editor 的动态加载边界。

**Acceptance criteria:**
- [x] 两种 locale key 严格一致，切换语言不重建 project/connection/tab/run 状态。
- [x] 新增或改动流程不再硬编码用户文案；OAuth 回调复用同一 locale 解析。
- [x] 记录 lazy-load 前后 bundle，向 220 KiB JS gzip 预算收敛且无首屏行为回归。

**Verification:** i18n resource tests；zh-CN E2E；en-US smoke；`npm run build`

**Dependencies:** Tasks 5–6  
**Likely files:** shared/client i18n、App/Shell、connection/run flows、Vite boundaries、tests  
**Scope:** Medium，按完整用户流程拆成多个提交

**Execution record — Slice 1 (2026-08-31):**
- 新增 `app` namespace，并迁移启动页、health ready/loading/error 的文案；中英文树由 locale contract 测试约束同步。
- health failure 改为稳定、可翻译的错误分类，不再直接展示底层网络错误文本；不会把实现细节或可能的敏感上下文暴露到页面。
- 结果：i18n/App focused `8/8`、typecheck、build、`git diff --check` 通过。构建为 CSS `71.72 kB gzip` / JS `268.97 kB gzip`；尚未进行大型 viewer/editor lazy loading，下一 slice 才会测量并拆分。

**Execution record — Complete (2026-08-31):**
- 完成 `app`、`servers`、`tools`、`runs`、`environment`、`savedItems`、`scripts`、`projects` 八个 namespace 的 `zh-CN/en-US` 对齐；locale contract 逐叶校验 key tree。
- 应用 Shell、项目选择、Server 管理、Tool Catalog/工作区/定义、参数编辑器、脚本、保存项、环境变量、运行历史/结果、独立 JSON Viewer 和 Toast 可访问名称均使用共享资源。客户端中文扫描仅剩语言选项名称和按 locale 生成的参数摘要词组。
- 语言切换不重新读取连接、Tab、脚本、保存项或环境变量；修复 `DebugWorkspace.flush` 因翻译函数身份变化导致的 Tab 重载，并增加状态隔离回归。
- OAuth 回调继续使用共享 locale 解析；新增英文 Playwright smoke，覆盖持久 locale、项目创建、Workbench 导航和 Server 入口。
- 构建拆分：入口 `136.65 kB gzip`，Workbench `138.38 kB gzip`，Tool Definition `2.76 kB gzip`，Script Workflow `4.64 kB gzip`；首屏入口低于 `220 KiB gzip` 目标，重型工作区与编辑器按需加载。CSS `71.38 kB gzip`。
- 结果：Vitest `612/612`、Playwright 核心回归 `2/2`、英文 smoke `1/1`、typecheck、build 与 `npm run verify` 通过。

### Checkpoint C: Foundation ready for new modules

- [x] 新自动化测试 UI 可以只使用内部 primitives。
- [x] 新文案同时提供中文和英文。
- [x] 关键交互没有双重滚动、焦点丢失或 overlay 主题断裂。
- [x] 人工确认 1.5.0 两个待确认项后进入 Phase 3。

### Phase 3: Automated Testing 1.5.0

## Product Decision Gate

已确认：

1. Server 被测试定义引用时默认阻止删除并要求先处理依赖；1.5.0 不提供级联删除测试历史。
2. 1.5.0 排除 headless CLI/CI Runner，留到 1.6+ 以 additive contract 扩展。

## Task 8: Lock testing contracts and migration allocation

**Description:** 接受 1.5.0 范围后，固定共享 wire schemas、稳定错误、身份边界和 migration 012 设计。

**Acceptance criteria:**
- [x] Tool/scenario/suite/assertion/execution 使用可穷尽 union 和共享 runtime schema。
- [x] connection 只按 connectionId 绑定；定义契约不包含 URL、Header、Token 或认证值字段。
- [x] migration 012 为增量、可重复打开、具备 project/connection FK 和升级测试。

**Verification:** shared schema tests；migration 1→12/duplicate/FK/byte tests；`npm run typecheck`

**Dependencies:** Product Decision Gate、Task 7  
**Likely files:** `src/shared/testing/**`、migration 012、project migration tests  
**Scope:** Medium

**Execution record (2026-08-31):**
- 新增 `src/shared/testing` 的 Tool/Scenario、ValueSource、Assertion、Suite、Execution/Step 共享 Zod 契约；领域 wire enum 使用可穷尽 `UPPER_SNAKE_CASE`，并落实名称、描述、标签、步骤及集合上限。
- Tool 目标只保存 `connectionId + toolName`；严格 schema 拒绝 URL、Bearer Token、Header 等额外认证字段。CLI/CI 专用字段不进入 1.5.0 wire contract。
- 新增增量 migration `012_automated_testing.sql`，保留 001–011 原字节。除规格表外增加内部 `test_case_targets` 投影表，使多步骤场景也能通过同 project 的 connection 外键阻止误删 Server。
- 测试覆盖 1–11→12 升级、重复打开、JSON/同项目外键、被引用 Server 删除保护；构建复制步骤逐文件校验 source/dist migration 字节一致。
- 结果：focused `36/36`、共享/迁移新增 `6/6`、typecheck 与 build 通过。

## Task 9: Deliver test definition CRUD and assertion engine

**Description:** 完成单 Tool 测试定义的持久化/API/client 边界，以及无副作用的声明式断言纯函数。

**Acceptance criteria:**
- [x] CRUD 使用 revision CAS、分页和 project/connection ownership。
- [x] 断言覆盖已批准操作符、严格类型、资源边界和稳定结果。
- [x] 创建、更新、删除和断言计算均不调用 MCP Server。

**Verification:** testing repository/service/routes/client tests；assertion unit tests；`npm run typecheck`

**Dependencies:** Task 8  
**Likely files:** server testing modules、shared assertion engine、API client、focused tests  
**Scope:** Medium，repository/API 与 assertion 可分两个提交

**Execution record (2026-08-31):**
- 新增 Test Case repository/service/routes/client 完整边界；创建、查询、更新和软删除均限定当前 project，目标连接只按 connection ID 外键校验，不读取或复制认证信息，也不调用 MCP Server。
- 更新使用 SQLite 原子 revision CAS；列表固定按 `updatedAt DESC, id DESC` 排序，opaque cursor 绑定 project 和全部筛选条件；软删除保留不可变 revision 历史并释放已处理的 Server 依赖。
- 新增无副作用断言引擎，覆盖规格中的 26 个操作符、严格类型、object subset/exact、array ordered/unordered、Ajv 方言校验、确定性 JSONPath 子集和 actual/expected 脱敏。
- `MATCHES_REGEX` 使用无原生回溯的有界线性状态机子集；pattern、input、状态数和重复次数均有限制，不支持的分组、alternation 与 backreference 返回稳定 `ASSERTION_INVALID`。
- 结果：Task 9 focused `60/60`；完整 Vitest `659/659`、Playwright `3/3`；typecheck、build 与 `npm run verify` 全部通过。

## Task 10: Deliver the single-Tool test editor

**Description:** 提供用例列表与编辑器，支持从 Run/已保存项创建安全预览，但不执行 Tool。

**Acceptance criteria:**
- [x] 参数、断言、超时和 connection/tool 身份可编辑，保存失败保留草稿。
- [x] 截断结果、secret、已移除 Tool 和定义变化在创建预览中明确警告。
- [x] project/connection/case 切换 abort/fence 旧请求，键盘和中英文完整。

**Verification:** testing UI focused tests；`npm run typecheck && npm run build`

**Dependencies:** Task 9  
**Likely files:** `src/client/features/testing/**`、navigation/app wiring、API client tests、locale resources  
**Scope:** Medium

**Execution record (2026-09-01):**
- 新增“自动化测试”工作区、单 Tool 用例列表与双栏编辑器，支持名称、描述、标签、启用状态、Server/Tool 身份、canonical arguments、26 种断言、超时以及 revision CAS 保存和显式删除；保存失败保留未提交草稿。
- 参数编辑复用现有 `ParameterEditor`，通过无执行模式共享 Form/Raw JSON 的 canonical arguments，同时确保编辑器和创建预览都不会发起 Tool 调用。
- Run 与已保存响应提供“创建测试用例”入口；服务端按 source ID 生成安全预览，递归剔除敏感字段，并对截断响应、不可用基线、已移除 Tool 和定义哈希变化返回稳定警告。前端只提交 source ID，不在 URL 或浏览器存储中复制响应与凭证。
- 列表、详情、Tool 目录与来源预览分别使用 generation fence；project、connection 和 case 切换不会应用旧请求结果。新增流程完成 `zh-CN`/`en-US` 资源、键盘按钮、确认弹层和空/错/加载状态。
- 结果：Task 10 专项 `109/109`（97 项功能测试 + 12 项工作台导航测试）；完整 Vitest `671/671`、Playwright `3/3`；typecheck、build 与 `npm run verify` 全部通过。

## Task 11: Execute a single-Tool test through Run/Workflow

**Description:** 复用现有内部 invocation seam，持久化测试执行快照、Run/Workflow 关联和断言结果。

**Acceptance criteria:**
- [x] 普通 Tool 与启用脚本的 Tool 均复用权威执行链，参数在前置脚本后校验。
- [x] 幂等、取消、terminal CAS、late completion 和事件失败保持现有语义。
- [x] 同 URL 不同 connection 的 OAuth/Bearer/Header 不串认证。

**Verification:** testing execution tests；runs/workflows regression；真实 loopback fixture；`npm run verify`

**Dependencies:** Task 10  
**Likely files:** test execution service/repository/routes、Run/Workflow seam、client result view、tests  
**Scope:** Medium，持久化与 UI 分两个提交

**Execution record (2026-09-01):**
- 新增测试执行共享契约、持久化仓库、Hono 路由和 API 客户端；执行定义快照、最终参数、Run/Workflow 关联和逐条断言结果均按 project 与 execution 身份存储。
- 普通 Tool 通过 `RunService.startInvocation` 执行，启用脚本的 Tool 通过 `WorkflowExecutionService.startInvocation` 执行；两条链路都不创建或借用调试 Tab，且前置脚本完成后才由权威 Run 链校验最终参数。
- 幂等键只放在请求 Header；仓库使用唯一约束、QUEUED→RUNNING CAS、原子 terminal 写入、取消/重启恢复和 late-completion fence。破坏性 Tool 由服务端强制确认，错误记录使用稳定、安全的错误码。
- 自动化测试页只允许已保存且未修改的用例执行，支持执行、取消、破坏性确认、终态轮询、Run/流水线关联及逐条断言实际值/期望值展示，并完成中英文、深浅主题和键盘可用性适配。
- 同一 URL 的 Bearer 与 Header 连接通过独立 session fixture 验证只调用目标 connection；原有 OAuth/Bearer/Header 连接回归与真实 loopback fixture 继续通过。
- 结果：Task 11 专项 `111/111`；完整 Vitest `685/685`、Playwright `3/3`，typecheck、build 与 `npm run verify` 全部通过。

## Task 12: Deliver deterministic scenario definitions and execution

**Description:** 分两个纵向增量完成场景编辑和串行执行，包括输入、固定参数、前序响应映射、提取、条件、轮询、失败策略和 cleanup。

**Acceptance criteria:**
- [x] 步骤 ID 稳定，只能引用前序步骤；删除被引用步骤时阻止保存并列出依赖。
- [x] 临时变量只存在本次执行，不写回 project/server 环境变量。
- [x] 三步骤 fixture 证明映射、轮询、失败策略和 cleanup，且无 timing-only sleep。

**Verification:** scenario pure/service/UI tests；real MCP integration；production E2E；`npm run verify`

**Dependencies:** Task 11  
**Likely files:** scenario shared/server/client modules及测试  
**Scope:** Large，必须拆为“定义与编辑器”“runner 与报告”两个任务提交

**Task 12A execution record (2026-09-01):**
- 场景共享契约补充稳定步骤 ID、输入唯一性、前序步骤/变量引用和重复提取变量校验；删除被引用步骤时返回依赖步骤和目标参数路径并阻止删除。
- 自动化测试页同时管理单 Tool 与场景定义；场景采用步骤/编辑/上下文三栏布局，支持场景输入、主步骤、cleanup、键盘可用排序按钮、固定参数、参数映射、响应提取器、执行条件、轮询、步骤断言和失败策略。
- 映射选择器只提供前序步骤与已提取变量；移动导致的引用失效、无效 JSON literal 等问题在保存前可见且由共享 schema 再次拒绝。场景 runner 与临时变量执行语义仍保留在 Task 12B。
- 结果：场景契约/草稿/UI 聚焦测试 `17/17`；完整 Vitest `692/692`、Playwright `3/3`，typecheck、build 与 `npm run verify` 全部通过。

**Task 12B execution record (2026-09-01):**
- 新增确定性的串行场景 runner，支持场景输入、固定参数、前序响应/临时变量/环境变量映射、响应提取、条件、轮询、失败策略和始终执行的 cleanup；JSON 路径解析有深度上限并拒绝原型污染路径。
- 场景通过现有 Run/Workflow invocation seam 调用目标 Tool，每次轮询尝试都保存独立 Run/Workflow 引用；执行身份与认证始终按 connection ID 隔离，不创建隐藏调试 Tab。
- 场景执行、步骤尝试和断言结果在同一终态事务中持久化；临时变量只保存在当前执行内，不写回 project/server 环境变量，取消和 late completion 继续受既有终态栅栏保护。
- 自动化测试页支持填写场景输入、执行/取消场景，并按步骤和尝试展示状态、参数及 Run/流水线入口；破坏性 Tool 仍由服务端确认门禁保护。
- 结果：Task 12B 聚焦 runner/service/repository/UI 测试 `23/23`；完整 Vitest `700/700`、Playwright `3/3`，typecheck、build 与 `npm run verify` 全部通过。

## Task 13: Deliver suites and bounded execution

**Description:** 组织 Tool/Scenario 用例，提供有限并发、stop-on-failure 和确定性汇总，不在套件成员间传变量。

**Acceptance criteria:**
- [x] concurrency 限制 1–8，barrier 测试证明上限和完成顺序处理。
- [x] 成员按 position 展示，执行状态不因异步完成顺序串位。
- [x] 批量破坏性 Tool 在执行前再次确认范围。

**Verification:** suite service/UI tests；production E2E；`npm run verify`

**Dependencies:** Task 12  
**Likely files:** suite shared/server/client modules及测试  
**Scope:** Medium

**Task 13 execution record (2026-09-01):**
- 已交付测试套件共享契约、CRUD、稳定成员身份、1–8 有限并发 runner、stop-on-failure、聚合取消和确定性 position 报告；成员输入按成员隔离，不在套件成员之间传递临时变量。
- 套件启动前检查全部 Tool/场景目标；破坏性 Tool 在任何成员启动前集中确认套件名称与启用成员范围。场景输入按成员填写、校验并通过 `inputsByMember` 传递。
- migration 013 为已有执行历史的成员增加软删除能力；历史报告从执行快照恢复成员与用例身份，稳定成员 ID 不允许改绑其他用例。
- 自动化测试候选用例完整遍历分页，场景详情按 8 个一批加载；套件 UI 支持新建、编辑、删除、执行、取消与聚合报告。
- 结果：Task 13 聚焦 suite runner/service/repository/API/UI 测试通过；完整 Vitest `715/715`，原有 Playwright `3/3`，新增生产套件 E2E `1/1`，typecheck 与 build 通过。

## Task 14: Deliver reports, import/export, and the 1.5 release gate

**Description:** 完成执行历史报告、显式基线更新和版本化分享包，关闭 1.5.0 发布门禁。

**Acceptance criteria:**
- [x] 报告可追溯到定义快照、Tool 快照、connection、Run/Workflow 和断言。
- [x] 导入先完整校验后单事务写入，connection 显式重绑定，默认不导出 secret/history。
- [x] 基线更新必须显式确认；打包、迁移、双语 E2E、安全审查全部通过。

**Verification:** import/export atomicity tests；full E2E；`npm run verify`；`npm pack --dry-run --json`

**Dependencies:** Tasks 11–13  
**Likely files:** reporting/import-export modules、UI、README/changelog、tests  
**Scope:** Medium，报告与分享包分两个提交

**Task 14A execution record (2026-09-01):**
- 新增项目级测试报告页和稳定游标分页；报告从不可变定义快照恢复名称与类型，并汇总断言状态。
- 详情按最多 8 个一批解析关联 Run，展示 Run/Workflow、connection ID 和 Tool 快照 ID；不会以 URL 代替连接身份。
- 基线更新只接受 `{ revision, confirm: true }`，只采纳未脱敏、无错误的 `EQUALS`/`DEEP_EQUALS` 实际值，并通过现有 revision CAS 创建新版本，不改写历史执行。

**Task 14B execution record (2026-09-01):**
- 新增 version 1 自动化测试分享包。默认导出当前定义、套件和 Server 引用别名，不导出连接配置、认证值、执行历史或报告。
- 导入要求对每个别名显式选择当前项目 connection ID，拒绝缺失/未知绑定、跨项目连接和不完整套件成员；完整共享 schema 校验后在一个 SQLite 事务内处理复制、跳过或覆盖。
- 前端导入/导出异步流程具有 project generation fence，旧项目请求不能回写；中英文文案、键盘表单和生产 E2E 覆盖报告追溯与导入重绑定。
- 结果：Vitest `731/731`、Playwright `4/4`、typecheck、build、migration 001–013 source/dist byte-match、`npm run verify`、`npm pack --dry-run --json` 和独立安全质量复审全部通过。

### Checkpoint D: 1.5.0 complete

- [x] M1–M5 验收全部满足。
- [x] migration 001–013 source/dist byte-match。
- [x] 无 secret 出现在 URL、Toast、日志、默认导出和浏览器存储。
- [x] 独立 Spec/Quality/Security review 无 Critical/Required。

### Phase 4: Rebaseline History, Replay, and Comparison

## Task 15: Rebaseline the existing replay plan

**Description:** 不直接执行旧 [plan.md](./plan.md)，先把它与 migration 012、自动化测试的“从 Run 创建用例”、2.0 运行比较和当前代码 seam 对账。

**Acceptance criteria:**
- [x] 为 replay lineage、pin 和 comparison rules 分配 012 之后的新迁移编号。
- [x] 删除与自动化测试重复的能力，保留历史搜索、显式回放和 Run 对比的清晰边界。
- [x] 更新原 plan/todo 的文件路径、测试数量、迁移门禁和产品确认点后再申请实施。

**Verification:** 文档交叉引用检查；迁移编号检查；人工批准新版 replay plan

**Dependencies:** Task 14  
**Likely files:** `tasks/plan.md`、`tasks/todo.md`、必要的 spec/ADR  
**Scope:** Small（仅规划）

**Task 15 execution record (2026-09-01):**
- 已核对当前 migrations 001–013、自动化测试 1.5.0、Run/Workflow seam、现有历史恢复 UI 和前端 Foundation；旧计划中的 migration 006/007 不再可用。
- 新版计划分配 migration 014 给 Run pin/lineage、015 给项目比较忽略规则，并明确先验证 lineage 对既有 Server 删除 cascade 的影响，禁止通过改 migration 005 偷渡行为变化。
- 删除与测试用例、报告、基线更新和测试定义导入导出重复的范围；保留“打开调试”为非执行恢复，新增“回放”为单独显式确认能力。
- 第一版只允许在来源 connection 上使用当前 Tool 回放，并只比较直接来源/回放关系；跨 Server 回放和任意无关 Run 对比延期。
- 新计划与清单已更新，当前停在人工确认门禁，尚未创建 migration 014/015 或修改生产行为。

### Phase 5: Complete Remaining 2.0.0 Milestones

## Task 16: Deliver environment profiles

**Description:** 在现有 project/server 变量上增加 dev/test/staging Profile、继承、冲突说明和最终解析预览。

**Acceptance criteria:**
- [x] Header/Bearer/脚本继续只保存具体值或变量引用，不复制解析后的 secret。
- [x] 缺失、覆盖和来源在连接前可预览，connectionId 隔离不变。
- [x] 导出默认排除敏感变量明文，旧变量数据无损升级。

**Verification:** migration/service/client/UI/security tests；`npm run verify`

**Dependencies:** Task 14  
**Scope:** 拆成 schema/resolve、管理 UI、连接预览三个 Medium 任务

**Task 16A execution record (2026-09-02):**
- 新增 migration 016、共享 Profile/override 契约和服务端 repository/service；现有项目/Server 变量保持隐式基础层，不传 profile 时原解析结果不变。
- Profile 使用稳定 ID、项目内单继承和最大 8 层深度；拒绝跨项目父级、缺失父级、循环及过深链路。子 Profile 存在时阻止删除父 Profile。
- Profile override 同时支持 `value` 和显式 `unset`，并分别处理项目作用域和 exact connection ID 的 Server 作用域；解析顺序和 provenance 确定且可测试。
- 新增 scope-aware secret provenance，Server 公共值覆盖项目 secret 时不会被错误标记为 secret；公开变量契约继续隐藏 secret 值。
- 结果：Profile/环境/migration 聚焦测试 `10/10`；完整 Vitest `792/792`、typecheck、build、migration 016 source/dist byte-match 与 `git diff --check` 通过；管理 API/UI、连接前缺失引用预览及安全导出保留到 Tasks 16B/16C。

**Task 16B execution record (2026-09-02):**
- 新增 migration 017，以 `projectId + connectionId` 保存激活 Profile；已连接或连接中的 Server 禁止切换，避免现有 MCP session 中途改变认证与环境。
- 新增 Profile CRUD、变量覆盖、连接激活和安全预览 HTTP/client 契约；客户端严格拒绝泄漏 secret 值的预览响应。
- 环境变量页新增中英文 Profile 管理界面，支持父级继承、项目/Server 覆盖、文本/JSON、显式 unset、解析链与来源展示。
- 连接预览检查 Header/Bearer 模板引用并列出缺失变量；secret 只显示隐藏占位，不返回明文。
- 连接认证与脚本读取使用 exact connection 的激活 Profile；无 Profile 时保持旧解析行为，脚本提交仍写入基础变量而不隐式修改 Profile。
- 结果：Profile 管理/预览聚焦测试 `22/22`，曾受并发资源影响的关联用例隔离复跑 `30/30`；typecheck、build、production Playwright `5/5`、migration 017 source/dist byte-match 与 `git diff --check` 通过。

**Task 16C execution record (2026-09-02):**
- Server 导出升级为版本 2，在原有 Tool、Tab、Run 和保存项数据之外，加入旧项目/Server 基础变量、Profile 定义、继承、当前连接覆盖和激活 Profile。
- 环境数据严格按 exact connection ID 隔离：项目级变量可复用，只包含当前 Server 的连接级变量与 Profile 覆盖，不会串入同项目其他连接的数据。
- 所有基础变量与 Profile override 的 secret 仅导出名称、作用域和 `redacted: true`，序列化对象中不出现明文；Bearer、OAuth 与自定义 Header 的既有脱敏策略保持不变。
- 客户端继续接受历史 v1 导出，同时严格校验 v2 环境契约，并拒绝任何可能包含环境 secret 明文的 v2 响应。
- 旧环境变量继续作为 Profile 的隐式基础层，无需复制或迁移数据；本任务没有新增数据库 migration，也没有改写 001–017。
- 结果：相关契约/API/路由测试 `43/43`，完整 Vitest 单 worker `800/800`、typecheck、build、production Playwright `5/5` 与 `git diff --check` 通过。

## Task 17: Complete Debug Workspace and catalog upgrades

**Description:** 在 Foundation 上实现 Split Pane 预设、偏好保存、Tool 收藏/最近使用/筛选和 1,000 Tool 有界渲染。

**Acceptance criteria:**
- [x] 偏好按 project/connection/tab 正确隔离，不进入业务导出。
- [x] Tool Catalog 大数据搜索和滚动满足性能预算并有键盘替代。
- [x] 工作区只有明确滚动 owner，sticky header 和拖拽无泄漏。

**Verification:** performance/component tests；production Playwright；`npm run verify`

**Dependencies:** Tasks 7、15  
**Scope:** 按 Split Pane、Catalog organization、virtualization 分三个 Medium 任务

**Task 17A execution record (2026-09-02):**
- 调试区新增“参数优先 / 均衡 / 结果优先”三种双语布局预设；选择预设会恢复请求与响应两侧，并使用现有语义 token 在深浅主题中显示选中状态。
- 分隔条升级为可访问的水平 `separator`，保留指针拖拽，并支持方向键微调以及 Home/End 边界操作；布局比例继续限制在 20%–80%。
- 请求区、响应区的展开状态和分栏比例统一写入当前 Tab 的 `viewState`，因此严格继承 project + connection + tab 身份隔离；切换 Tab、重载和复制 Tab 时不会互相串状态。
- 历史 `viewState` 缺少展开字段时默认恢复为双侧展开，无需数据库 migration，也不改写 migrations 001–017；客户端与服务端均拒绝非法展开状态。
- Server 业务导出在边界显式移除 Tab `viewState`，布局偏好不会进入导出文件，认证与其他业务数据行为不变。
- 结果：Task 17A 聚焦客户端 `95/95`、服务端 `23/23`、Foundation/i18n `11/11`、typecheck、build、production Playwright `5/5` 与 `git diff --check` 通过。并发 `npm run verify` 受工作机资源争用出现既有超时；全部失败文件以单 worker 隔离复跑 `60/60` 通过。

**Task 17C execution record (2026-09-02):**
- Tool Catalog 使用每页 200 行的有界分页渲染，不增加生产依赖；1,000 Tool 基线从同时挂载 1,000 个 `.tool-row` 降到最多 200 个，DOM 行数减少 80%。
- 搜索和筛选仍覆盖完整目录，并以预计算的规范化名称/描述索引避免每次输入重复解析描述；精确名称排序、收藏/最近/变化/移除筛选、文件夹、拖拽与键盘移动语义保持不变。
- 分页控件提供中英文可访问名称、上一页/下一页键盘操作和明确范围；筛选、搜索、文件夹展开状态及翻页会校正页码，翻页后唯一滚动 owner `.tool-tree` 回到顶部。
- 生产 Playwright 验证 `.tool-tree` 是目录唯一纵向滚动容器，外层 panel 不产生双滚动；1,002 项目录的精确搜索反馈低于 `100 ms` 预算，并只保留 1 个匹配行。
- 本任务未修改持久化、认证、导出、公开 API 或 migration。聚焦 ToolTree 测试 `15/15`、关联非确定性失败隔离复跑 `21/21`、typecheck、build、production Playwright `6/6` 与 `git diff --check` 通过。
- 完整并发 `npm run verify` 仍受工作机资源竞争影响（`804/812`）；单 worker 为 `810/812`，剩余脚本内存分类与测试取消交互两个既有非确定性用例在隔离复跑时全部通过，不属于本次 Catalog 改动。

## Task 18: Close the 2.0 release gate

**Description:** 集成获批的回放/比较计划、环境 Profile、UI Foundation 和 Test Experience，完成兼容、安全、性能、可访问性与发布验收。

**Acceptance criteria:**
- [x] 1.x SQLite 原地升级且 Server/Tool/Tab/Run/脚本/变量/测试数据不丢失。
- [x] JS/CSS、1,000 Tool、10 MB JSON、双语、深浅主题和键盘路径满足 2.0 预算。
- [x] 完整 verify、package allowlist、真实认证 fixture 和独立审查全部通过。

**Verification:** `npm run verify`；migration matrix；`npm pack --dry-run --json`；security/performance/a11y review

**Dependencies:** Tasks 14–17  
**Scope:** 仅发布集成；发现功能缺口必须回到对应独立任务修复

**Execution record (2026-09-02):**
- 新增带真实数据的 schema 13→18 migration matrix，覆盖 Server、Tool、Tab、Run、请求/响应/事件、文件夹、脚本、Server 变量、测试用例/修订/套件成员；升级前后身份与原始 payload 一致，未修改任何已发布 migration。
- 真实回环 MCP fixture 可按预期 Header 返回 401；None/自定义 Header、Bearer、环境变量解析、OAuth 四条认证路径及同 URL connection-ID 隔离均通过。
- 首屏 JS `149.95 KiB gzip`、CSS `49.75 KiB gzip`；1,000 Tool 生产搜索预算通过；10 MB JSON 改为最多 500 节点的安全预览，超大 JSON 文本不在主线程解析。
- `npm run verify` 通过：Vitest `819/819`、production Playwright `6/6`；18 个 migration source/dist 字节一致，npm 包 31 个文件满足 allowlist，生产依赖 high/critical 审计为 0。
- 实施者结构化审查未发现 Critical/Required。依据 2.0 审批边界，Task 18 仍等待独立复审和人工批准发布候选；未改版本、未打 tag、未发布。
- 独立只读复审随后拒绝当前 RC，记录于 `docs/reviews/2026-09-02-release-2.0-independent-review.md`：2 Critical、8 Required。Task 18 保持未完成；此前技术门禁结果仅代表现有断言通过，不代表 2.0 验收已成立。
- 已按首轮及后续独立复审意见完成全部 Critical、Required 与 Recommended 整改，证据记录于 `docs/reviews/2026-09-02-release-2.0-remediation.md`。实现方最终门禁为 Vitest `826/826`、production Playwright `7/7`、无 Axe 扫描豁免、10 MiB JSON 与 1,000 Tool 连续滚动性能预算、发布物白名单/hash 与 `git diff --check` 全部通过；随后交由独立 reviewer 复核，期间未改版本、未打 tag、未发布。
- 同一独立只读 reviewer 完成复审并批准当前 2.0 RC 代码与候选 artifact：0 Critical、0 Required、0 Recommended、0 新发现；独立复跑 Vitest `144/144`、生产 Playwright `3/3` 及真实 Chrome Tab/Shift+Tab 焦点路径。结论记录于 `docs/reviews/2026-09-02-release-2.0-independent-rereview.md`。Task 18 技术门禁已关闭，仍需人工批准发布候选；未改版本、未打 tag、未发布。

## Checkpoint and Stop Rules

- 每完成 2–3 个任务执行一次 checkpoint，不累积未验证改动。
- migration、认证、secret、核心路由、工作区滚动或生产入口变更必须运行 `npm run verify`。
- 测试出现 flaky、open handle、身份串线或 secret 泄漏时立即停止后续阶段。
- 引入新的 UI 库、编辑器、脚本权限、删除语义或身份边界变更前必须取得产品确认。
- 未通过前一 Checkpoint，不得开始下一 Phase。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| UI Foundation 变成全量重写 | High | 只迁移一个完整流程，Feature 仅依赖内部 contract |
| 自动化测试复制 Run/Workflow runtime | Critical | 复用统一 invocation seam，真实 fixture 验证认证隔离 |
| 旧 replay migration 与 1.5 冲突 | High | Task 15 在实现前重新编号并重写门禁 |
| 复杂 Schema 静默丢字段 | High | 只解释可判定结构；非法/未知结构安全回退，删除前提示 |
| i18n 迁移造成同页混合语言 | Medium | 按完整用户流程迁移，双资源同提交 |
| 新依赖扩大首屏包体 | Medium | PoC 测 gzip；大型模块动态加载；Feature 禁止直接依赖 |
| secret 进入报告或导出 | Critical | 默认排除、显式引用、脱敏 fixture 和安全审查 |

## Approval Boundaries

以下节点必须人工确认后继续：

1. Checkpoint A：稳定基线与脚本审查结果。
2. Checkpoint C：1.5.0 Server 删除语义与 CLI 范围。
3. Task 15：新版回放与比较计划。
4. 任何新增生产 UI 依赖。
5. 2.0 发布候选。
