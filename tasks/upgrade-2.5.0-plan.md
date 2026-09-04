# MCP Inspector 2.5.0 开发计划：测试套件执行报告

## 总览

本计划把测试套件的简略状态列表升级为可浏览历史、逐调用下钻并保存命名版本的执行报告。权威产品与技术契约见 [`docs/UPGRADE-2.5.0.md`](../docs/UPGRADE-2.5.0.md)。

实现遵循四条主线：

- 复用现有 Suite Execution → Test Execution → Run 数据链，不复制完整响应。
- 并发结果使用层级列表导航，但任何时刻只呈现一个 Tool 调用详情。
- 自动历史与人工保存版本分离；保存版本是不可变执行引用和保留锁。
- 复用现有 `RunResultPanel` 和共享运行契约，不创建第二套 Tool 响应系统。

## 依赖关系

```text
共享契约与测试夹具
      │
      ├── 套件执行历史
      ├── 报告 Outline 聚合
      └── 保存报告迁移/领域服务
              │
              ▼
      客户端按需数据层
              │
      ┌───────┴────────┐
      ▼                ▼
报告导航与单一详情   保存版本交互
      └───────┬────────┘
              ▼
     测试报告页集成与发布验证
```

## Task 1：锁定报告契约与确定性夹具

**内容：** 定义套件执行摘要页、报告 Outline、成员调用摘要、保存报告、分页和稳定错误的共享 Zod 契约；建立单 Tool、场景多步骤、重试、清理、并发、取消和缺失 Run 夹具。

**验收标准：**

- 客户端与服务端复用同一契约，不用手写重复 DTO。
- Outline 不携带完整 Run 响应，只携带可验证的导航关系和摘要。
- 夹具使用固定时钟与 ID，可稳定断言排序、默认选择和耗时。
- 非法状态、未知字段、越界分页、错误引用关系被拒绝。

**验证：** 共享 schema 单元测试；`npm run typecheck`。

**依赖：** 无。

**预计文件：**

- `src/shared/testing/test-suite-report.ts`
- `src/shared/testing/test-suite-execution.ts`
- `src/shared/testing/__tests__/test-suite-report.test.ts`
- 测试夹具文件

**规模：** 中。

## Task 2：提供套件执行历史分页

**内容：** 在现有 Suite Execution Repository/Service/Routes 上增加按套件查询的稳定游标分页，并补充客户端方法。

**验收标准：**

- 仅返回请求项目与套件的记录，按 `createdAt DESC, id DESC` 稳定排序。
- 支持状态和时间摘要；不加载成员完整响应。
- 同 URL 不同连接、跨项目、跨套件均不能串读。
- 执行期间轮询只更新对应 execution ID，不重排用户当前选择。

**验证：** Repository/Service/Route/API client 测试；分页边界和身份隔离测试。

**依赖：** Task 1。

**预计文件：**

- `src/server/testing/test-suite-execution-repository.ts`
- `src/server/testing/test-suite-execution-service.ts`
- `src/server/testing/test-suite-execution-routes.ts`
- `src/client/api/api-client.ts`
- 聚焦测试

**规模：** 中。

## Task 3：构建报告 Outline 聚合服务

**内容：** 新增只读聚合服务，从 Suite Execution Items 关联 Test Executions 和 Step Records，生成按快照顺序组织的成员与调用摘要。

**验收标准：**

- 服务端逐层验证 project、suite、suite execution、test execution、step 和 Run 的归属关系。
- 成员按 `position` 排序，调用按步骤位置、attempt 和记录 ID 稳定排序。
- 运行中、取消、跳过、缺失 Test Execution/Run 都有明确表示，不因单个缺失记录使整份报告失败。
- 历史名称和修订来自执行快照，不依赖当前定义。

**验证：** 聚合服务与路由集成测试；错误外键、改名/删除定义、缺失 Run 和并发时序测试。

**依赖：** Tasks 1–2。

**预计文件：**

- `src/server/testing/test-suite-report-service.ts`
- `src/server/testing/test-suite-execution-routes.ts`
- `src/server/testing/test-execution-repository.ts`
- `src/client/api/api-client.ts`
- 聚焦测试

**规模：** 中。

### Checkpoint A：可读取的真实报告骨架

- [ ] 可以分页打开任一套件执行历史。
- [ ] 可以取得成员和调用 Outline，且无完整响应放大。
- [ ] 排序、快照名称、并发状态和缺失记录语义稳定。
- [ ] 项目、连接、套件、执行和 Run 引用链隔离通过。

## Task 4：新增保存报告持久化与引用保护

**内容：** 实现下一编号 SQLite 迁移、保存报告 Repository 和保留规则。迁移编号在编码前重新检查，禁止修改已发布迁移。

**验收标准：**

- 保存名称、版本标签、备注和 Suite Execution 引用，不复制参数/响应。
- `(projectId, suiteId, normalizedVersionLabel)` 唯一；大小写和首尾空白规范化规则有测试。
- 复合外键阻止跨项目或跨套件引用。
- 被保存版本引用的执行链不会被历史清理破坏；删除保存版本不级联删除历史。
- 既有数据库可无损升级，source/dist 迁移一致。

**验证：** migration matrix、Repository 集成测试、删除/保留行为测试、迁移字节测试。

**依赖：** Task 1；实现前迁移号检查。

**预计文件：**

- 下一编号迁移 SQL
- `src/server/testing/saved-test-suite-report-repository.ts`
- `src/server/testing/__tests__/saved-test-suite-report-repository.test.ts`
- 迁移清单/发布制品配置

**规模：** 中。

## Task 5：提供保存报告服务与 API

**内容：** 实现保存报告的列表、创建、读取、元数据更新和删除；创建支持幂等键，更新支持 revision。

**验收标准：**

- 只能保存同项目、同套件的终态执行。
- 同一幂等键和载荷重放返回同一结果；载荷不同返回稳定冲突。
- 版本标签冲突返回 `REPORT_VERSION_CONFLICT`，不覆盖旧报告。
- PATCH 不能改变 Suite Execution 引用；revision 冲突可恢复。
- 参数、响应和凭据不进入普通日志、错误、URL 或 Toast。

**验证：** Service/Route/API client 测试；幂等、并发更新、跨身份和秘密夹具测试。

**依赖：** Task 4。

**预计文件：**

- `src/server/testing/saved-test-suite-report-service.ts`
- `src/server/testing/saved-test-suite-report-routes.ts`
- `src/client/api/api-client.ts`
- 服务与路由聚焦测试

**规模：** 中。

## Task 6：抽取可复用的单次调用详情

**内容：** 从现有测试执行与场景报告中抽取轻量适配层，将步骤最终参数、断言和选中 Run 交给现有 `RunResultPanel` 展示。

**验收标准：**

- 展示最终解析参数、上下文、错误、时间、断言和 Tool 响应视图。
- 不复制 `RunResultPanel` 的 Overview/Details/HTTP/RPC/Timeline/Workflow 实现。
- 历史查看只读，不修改当前 Tool 调试 Tab。
- 加载中、无 Run、Run 已不可用和部分响应状态有稳定空态。
- 大响应与 JSON 查看沿用既有脱敏、复制和放大行为。

**验证：** 组件测试；参数/响应/错误/无 Run 夹具；回归现有 Test Execution 与 Scenario 面板。

**依赖：** Tasks 1、3。

**预计文件：**

- 新的共享调用详情组件
- `src/client/features/testing/TestExecutionPanel.tsx`
- `src/client/features/testing/ScenarioExecutionPanel.tsx`
- `src/client/features/runs/RunResultPanel.tsx`（仅在必要时扩展接口）
- 组件测试

**规模：** 中。

## Task 7：交付套件报告层级导航

**内容：** 将 Test Suites 页底部状态列表替换为可整体折叠的报告工作台：报告选择、摘要、成员 Disclosure、调用列表和单一详情面板。

**验收标准：**

- 成员可展开/收起；展开只显示调用导航，不内联大型响应。
- 任意时刻最多挂载一个完整响应查看器。
- 默认选择第一个失败调用，否则选择第一个可查看调用。
- 成员顺序不因并发完成顺序变化；真实开始时间和耗时可见。
- 保留每个项目/套件的兼容选择状态；项目或套件变化清理不兼容状态。
- Disclosure、Tabs、列表和详情可键盘访问，状态不只依赖颜色。

**验证：** React 组件测试；并发完成、快速切换、迟到响应、键盘/焦点和 zh-CN/en-US 测试。

**依赖：** Tasks 2、3、6。

**预计文件：**

- `src/client/features/testing/TestSuitesPage.tsx`
- 新的 `TestSuiteReportViewer` 组件及样式
- `src/client/features/testing/testing.css`
- locale 文件
- 组件测试

**规模：** 大，建议拆成“历史+摘要”和“导航+详情”两个可合并切片。

### Checkpoint B：并发结果可用

- [ ] 单 Tool、场景多步骤、重试和清理均能下钻到调用详情。
- [ ] 8 个并发成员完成顺序随机时，成员位置和当前选择稳定。
- [ ] 失败执行默认定位到失败调用。
- [ ] 页面不会同时渲染多个完整响应区。
- [ ] 快速切换项目/套件/执行时没有迟到数据串入。

## Task 8：交付保存版本交互

**内容：** 在套件报告工具栏增加保存对话框和已保存版本选择；支持编辑名称/版本/备注及删除版本标记。

**验收标准：**

- 只有终态执行显示可用的“保存报告”。
- 用户可分别保存 `1.0` 和 `2.0`，并从历史选择器重新打开。
- 冲突、revision 过期和网络错误保留表单输入并提供明确恢复路径。
- 删除需确认，且文案明确“只删除保存版本，不删除执行历史”。
- 对话框焦点进入、循环和返回符合现有 primitive 行为。

**验证：** 表单、冲突、更新、删除、焦点和国际化组件测试；API 集成测试。

**依赖：** Tasks 5、7。

**预计文件：**

- 新的保存报告对话框组件
- `TestSuiteReportViewer` 组件
- locale 文件
- 组件测试

**规模：** 中。

## Task 9：集成测试报告页

**内容：** 在现有 Test Reports 页增加“测试用例 / 测试套件”视图，套件视图复用同一报告查看器，并提供套件、状态、保存状态和版本标签筛选。

**验收标准：**

- 现有测试用例报告行为、导入导出和选择状态无回归。
- 套件普通历史与保存版本在列表中有明确区分，不产生两份执行内容。
- 从套件页打开报告时能准确导航到同一 project/suite/execution/report。
- 列表与详情有单一、明确的滚动所有者，窄屏仍可使用。

**验证：** 页面集成测试、路由/状态恢复、布局、窄屏和现有报告回归测试。

**依赖：** Tasks 7–8。

**预计文件：**

- `src/client/features/testing/TestReportsPage.tsx`
- `TestSuiteReportViewer` 组件
- 相关样式和 locale
- 页面测试

**规模：** 中。

## Task 10：实时更新、缓存与性能收口

**内容：** 为运行中报告增加有界轮询/刷新，为调用详情增加项目隔离的有界缓存和取消机制，并验证大型 Outline。

**验收标准：**

- 轮询仅在非终态时运行，页面卸载、项目切换或执行终态后停止。
- 旧请求不能覆盖当前选择；缓存键包含 projectId 和 runId。
- 100 个成员 × 每成员 20 次调用的 Outline 可交互，初始加载不请求 2,000 个完整 Run。
- 大型响应切换时不保留多个隐藏响应查看器。
- 失败的单个详情请求不阻塞其他调用查看。

**验证：** fake timer、AbortController、LRU、性能夹具和浏览器内存/DOM 断言。

**依赖：** Tasks 7–9。

**预计文件：**

- 报告数据 hooks/store
- `TestSuiteReportViewer` 组件
- 性能与交互测试

**规模：** 中。

## Task 11：完成端到端、安全与可访问性验证

**内容：** 覆盖从执行套件到保存 `1.0`/`2.0`、重新打开和删除版本的真实用户旅程，并完成安全、隐私和无障碍检查。

**验收标准：**

- 单调用、多步骤、重试、清理、并发、失败、取消和缺失 Run E2E 通过。
- 套件/用例改名后历史仍使用快照；保存版本保护执行链。
- 同 URL 不同连接、跨项目和伪造 Run ID 均不能读取数据。
- 已知秘密不会出现在日志、Toast、URL、埋点、新表或默认导出。
- 键盘、焦点、读屏状态、缩放、浅色/深色及 zh-CN/en-US 通过。

**验证：** 浏览器 E2E、服务端安全集成测试、无障碍扫描和人工键盘检查。

**依赖：** Tasks 1–10。

**预计文件：**

- 测试套件 E2E 文件
- 安全/迁移集成测试
- 必要的测试夹具

**规模：** 大。

## Task 12：关闭 2.5.0 发布门槛

**内容：** 完成版本说明、迁移制品、兼容性验证、性能基线和完整仓库门禁。

**验收标准：**

- 版本文档和实际契约一致，无开放 Required/Critical 问题。
- 已发布迁移字节未变化，旧数据库无损打开，新迁移 source/dist 一致。
- `npm run verify`、发布制品检查、pack dry run 和 diff 检查通过。
- 无未处理的高/严重可达依赖风险。
- 产品确认“层级列表 + 单一详情”与保存版本语义。

**验证：** 完整 CI/本地门禁和独立代码审查。

**依赖：** Tasks 1–11。

**预计文件：**

- `package.json` / lockfile（发布时）
- 版本说明与升级文档
- 发布制品配置

**规模：** 小至中。

## 建议迭代节奏

1. **Sprint A：读取骨架** — Tasks 1–3，完成历史 + Outline 垂直切片。
2. **Sprint B：可保存领域** — Tasks 4–5，完成命名版本和保留规则。
3. **Sprint C：核心体验** — Tasks 6–8，完成层级导航、单一详情和保存交互。
4. **Sprint D：完整入口** — Tasks 9–10，集成测试报告页并收口实时性/性能。
5. **Sprint E：发布** — Tasks 11–12，完成 E2E、安全、可访问性和发布门禁。

每个 Sprint 结束均要求聚焦测试通过；涉及核心工作流、持久化、路由或布局的合并前运行 `npm run verify`。
