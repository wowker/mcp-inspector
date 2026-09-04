# MCP Inspector 2.5.1：受控压力测试

## 1. Objective

2.5.1 在现有自动化测试之上增加本地单节点压力测试。开发者和测试人员可以选择一条已保存的单 Tool 或场景测试，配置闭环虚拟用户负载，实时观察吞吐、延迟和错误，并保存可追溯的历史报告。

成功意味着：用户无需重新填写 Tool 参数或重新编排场景；压力不会因嵌套并发、无限循环或破坏性 Tool 意外失控；报告可以说明“施加了什么负载、执行了多少轮、是否达到阈值、哪些调用失败或最慢”。

## 2. Product Boundaries

### 2.1 In scope

- 压测目标为一个已保存测试用例，支持 `tool` 和 `scenario`。
- 闭环模型：虚拟用户数、升压时间、持续时间、思考时间、最大迭代数。
- 安全上限：虚拟用户 `1–20`、持续时间 `1–600s`、升压 `0–120s`、思考时间 `0–10s`、最大迭代 `1–1,000`。
- 阈值：最大错误率、最大 P95、最低平均 RPS；可配置达到错误率阈值后自动停止。
- 同一项目最多一个 `QUEUED/RUNNING` 压测。
- 运行、取消、历史、汇总、样本列表和单一样本详情。
- 压测定义和执行使用快照，后续修改或软删除目标用例不改变历史。

### 2.2 Out of scope

- 测试套件目标、固定 RPS、多阶段曲线和分布式执行。
- 浏览或并排渲染所有完整响应。
- 跨报告趋势比较和容量预测。
- 在压测界面修改目标用例参数编排。

## 3. Domain Model

### 3.1 PressureTestDefinition

```ts
type PressureTestDefinition = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  revision: number;
  target: { testCaseId: string };
  inputs: JsonObject;
  load: {
    virtualUsers: number;
    rampUpMs: number;
    durationMs: number;
    thinkTimeMs: number;
    maxIterations: number;
  };
  thresholds: {
    maxErrorRate: number;
    maxP95DurationMs: number;
    minRequestsPerSecond: number;
    stopOnErrorRate: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
```

`maxErrorRate` 使用 `0–1` 比例。定义保存时验证场景输入，但不复制连接凭据。删除使用软删除；已有执行继续通过快照读取。

### 3.2 PressureTestExecution

执行状态为 `QUEUED | RUNNING | PASSED | FAILED | ERROR | CANCELLED | INTERRUPTED`。执行保存压力定义快照和目标测试用例的名称、类型、修订；终态汇总包括：

- 总迭代、成功、失败、错误、取消。
- 实际错误率、平均/峰值 RPS。
- 最小、最大、平均、P50、P90、P95、P99 延迟。
- 每条阈值的目标值、实际值和通过状态。
- 熔断原因或安全错误摘要。

### 3.3 Samples

每轮保存轻量样本：虚拟用户序号、迭代序号、Test Execution ID、状态、开始时间、耗时和安全错误摘要。完整参数和响应仍由已有 Test Execution → Run 链提供。

报告默认只列出有界代表样本：

- 最多 100 个失败/错误样本。
- 最多 50 个最慢样本。
- 首次、末次和最多 20 个确定性成功样本。

服务端列表接口必须分页；UI 任何时刻最多加载一个完整 Test Execution/Run 详情。

## 4. Load Semantics

每个虚拟用户在自己的升压时间点启动，并循环：

```text
认领全局迭代号 → 执行目标测试用例 → 记录样本 → 思考等待 → 下一轮
```

- 不在 `durationMs` 到期后认领新迭代。
- 全局认领数不得超过 `maxIterations`。
- 取消后不再认领新迭代，并将信号传递给正在执行的测试。
- 错误率熔断至少在 20 个样本后评估，避免首个失败造成误停。
- 终态阈值判定以全部已完成样本为准；任一阈值未通过则执行为 `FAILED`。
- 调度器使用单进程内存协调；服务重启后遇到遗留活动执行时标记为 `INTERRUPTED`。

## 5. Security and Privacy

### Trust boundaries

- 表单、路由体、查询参数和游标均是不可信输入，使用严格共享契约验证。
- Test Case、Pressure Test、Execution、Sample、Test Execution 和 Run 的引用必须同时匹配项目 ID。
- SQL 全部参数化；错误响应只返回稳定错误码和安全摘要。

### Abuse controls

- 单项目唯一活动执行由数据库部分唯一索引强制保证。
- 启动采用 Idempotency-Key 和请求哈希，重试不会重复施压。
- 破坏性 Tool 默认拒绝；只有启动请求显式确认后才允许整个批次执行。
- 所有负载字段有服务端硬上限，不信任客户端控件。
- 不把凭据、完整参数或响应复制到压力定义、汇总、Toast、URL 或普通日志。

## 6. API

```http
GET    /api/projects/:projectId/pressure-tests
POST   /api/projects/:projectId/pressure-tests
GET    /api/projects/:projectId/pressure-tests/:pressureTestId
PATCH  /api/projects/:projectId/pressure-tests/:pressureTestId
DELETE /api/projects/:projectId/pressure-tests/:pressureTestId

GET    /api/projects/:projectId/pressure-tests/:pressureTestId/executions?cursor=&limit=
POST   /api/projects/:projectId/pressure-tests/:pressureTestId/executions
GET    /api/projects/:projectId/pressure-test-executions/:executionId
POST   /api/projects/:projectId/pressure-test-executions/:executionId/cancel
GET    /api/projects/:projectId/pressure-test-executions/:executionId/samples?kind=&cursor=&limit=
```

- POST 创建定义返回 `201`。
- PATCH 使用 `revision` 乐观并发控制。
- DELETE 软删除定义，不删除历史。
- 启动 POST 必须提供 `Idempotency-Key`；同键不同请求返回稳定 `409`。
- 活动任务冲突返回 `409 PRESSURE_TEST_ACTIVE_CONFLICT`。
- 破坏性目标未确认返回 `409 DESTRUCTIVE_CONFIRMATION_REQUIRED`。
- 列表使用绑定 project/parent identity 的稳定游标。

## 7. UI Design

### 7.1 Navigation and editor

侧边栏在“测试套件”和“测试报告”之间新增“压力测试”。页面沿用现有测试工作台：左侧方案列表，右侧编辑器，不引入新组件库。

```text
┌ 压力测试 ─────────────────────────────────────────────────────┐
│ 压测方案列表 │ 订单创建压力测试                       [启动压测] │
│ + 新建方案   ├─────────────────────────────────────────────────┤
│ 订单创建     │ 基本信息：名称 / 描述 / 测试目标                 │
│ 商品查询     │ 负载：VU / 升压 / 持续 / 思考 / 最大次数         │
│              │ 阈值：错误率 / P95 / 最低 RPS / 自动停止         │
│              │ 场景输入：只编辑已声明输入，不在此修改步骤        │
└──────────────┴─────────────────────────────────────────────────┘
```

只有保存后的方案可以运行。同一区域只有一个主要动作；运行中主动作替换为“停止压测”。破坏性确认复用现有 Dialog。

### 7.2 Live run

编辑器下方显示可折叠实时区：

```text
运行中 02:31 / 05:00                                      [停止]
VU 10 │ RPS 24.8 │ 迭代 372 │ 错误率 0.7% │ P95 612ms
吞吐/延迟紧凑时间序列（SVG + 同等语义数据表）
最近失败与慢调用列表 → 选择一个 → 单一 Tool 调试式详情
```

2.5.1 不新增图表依赖。曲线使用受控 SVG，必须同时提供文字指标和表格，使信息不依赖颜色或图形。

### 7.3 Report entry

测试报告页增加“压力报告”Tab：

```text
用例报告 | 套件报告 | 压力报告
```

左侧按方案、状态和日期浏览执行批次；右侧显示汇总、阈值、分位延迟、错误分类及代表样本。样本详情复用现有 `TestExecutionPanel` / `RunResultPanel`，不修改当前 Tool 调试 Tab。

### 7.4 Responsive and accessibility

- 1024px 以上为列表/编辑器或样本/详情双栏。
- 760px 以下上下排列，分别保持明确滚动所有者。
- Tabs 使用完整 ARIA 键盘语义；状态同时显示文字。
- SVG 提供可访问名称；实时指标使用节制的 `aria-live`，不逐样本播报。
- 支持浅色、深色、200% 缩放和 `prefers-reduced-motion`。

## 8. Project Structure and Commands

- 共享契约：`src/shared/testing/pressure-test.ts`
- 服务端：`src/server/testing/pressure-test-*.ts`
- 迁移：`src/server/projects/migrations/020_pressure_testing.sql`
- 客户端：`src/client/features/testing/PressureTestsPage.tsx` 及聚焦子组件
- 测试：相邻 `__tests__`、服务端集成测试和 `e2e/pressure-test.spec.ts`

```bash
source /Users/wuwei/.nvm/nvm.sh && nvm use 22.23.2
npm test -- --run <focused-test>
npm run typecheck
npm run verify
npm run verify:release-artifacts
npm pack --dry-run --json --cache /private/tmp/mcp-inspector-npm-cache
```

## 9. Testing Strategy

- 纯函数：分位数、聚合、阈值、升压计划、熔断和迭代认领。
- Repository/Service：迁移、身份隔离、幂等、唯一活动执行、取消、重启中断和分页。
- API：严格请求/响应解码及稳定错误。
- React：表单边界、草稿隔离、实时轮询、迟到响应、停止、样本单详情和无障碍。
- E2E：创建方案、运行受控短压测、观察指标、打开样本详情、在报告页重开。

## 10. Success Criteria

- 压测实际并发不超过配置 VU，迭代不超过上限，到期或取消后不再调度。
- 20 VU × 1,000 轻量样本聚合不出现未界定增长；列表全部分页。
- 错误率、RPS 和分位数由确定性测试证明，阈值结论可复现。
- 破坏性目标、跨项目引用、重复启动和幂等重放均安全失败。
- 页面只挂载一个完整调用详情，项目/方案/执行切换无迟到数据串入。
- 现有 SQLite 无损升级，迁移和发布制品一致。
- `npm run verify`、制品检查和打包预检通过。

## 11. Boundaries

- Always：共享 Zod 契约、参数化 SQL、项目身份链验证、有界调度、回归测试、复用 UI tokens/primitives。
- Ask first：扩大硬上限、支持破坏性目标默认执行、新依赖、分布式执行或改变现有 Run 保留语义。
- Never：无限循环、无限响应保留、凭据复制、跨项目缓存、以客户端校验作为安全边界、修改已发布迁移。
