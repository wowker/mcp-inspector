# MCP Inspector 2.0.4 更新计划

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Implemented，完整质量门禁已通过 |
| 目标版本 | `2.0.4` |
| 当前代码基线 | `2.0.0` |
| 前置版本 | [MCP Inspector 2.0.3 更新计划](./UPGRADE-2.0.3.md) |
| 更新日期 | 2026-09-03 |
| 适用范围 | 自动化测试编辑、断言配置、测试执行结果、国际化与无障碍 |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |

> 2.0.4 是自动化测试结果可追溯性与表单交互收敛版本。它不新增 API、SQLite migration
> 或持久化字段，不改变 project、connection、test case、execution 与 Run 的身份边界。

## 1. 目标与非目标

目标：在测试执行后直接查看关联 Run 的完整响应；让断言长选项复用统一搜索下拉框；将持续启用状态改为 Switch；把标签格式提示放入输入框。

非目标：不重写 Run 结果展示、不改变断言运算语义、不自动保存测试定义，也不修改测试执行服务和数据库。

## 2. 用户流程

1. 用户保存并执行单 Tool 或场景测试。
2. 执行完成后，客户端按执行步骤中的稳定 Run ID 拉取响应详情。
3. “响应结果”区域复用 Tool 调试的结果面板，可查看请求与结果、调用详情、HTTP、RPC 和时间线。
4. 配置断言时可搜索数据源和运算符；选中值继续保存为原有稳定枚举。
5. “启用此测试用例”以 Switch 表达持续配置；标签格式提示显示在输入框内。

## 3. 状态模型与身份边界

- 响应区域覆盖 loading、ready、empty 和 error；执行记录本身不会因响应详情加载失败而丢失。
- 每次选择、创建、取消或重新执行都会递增 execution generation；旧请求完成后不得写入新用例。
- Run 详情必须同时匹配当前 `projectId` 和请求的 `runId`。
- 场景中的多个 Run 以八个一批加载，按执行步骤顺序展示。

## 4. API 与数据模型

- 复用现有 `getRun(projectId, runId)` 和 `RunDetail` 运行时解码。
- 复用 `TestExecutionDetail.steps[].runId`，不增加 wire schema 或数据库字段。
- 断言 source/operator、测试 enabled 状态和 tags 仍使用原数据结构。

## 5. UI、键盘与可访问性

- 响应面板直接复用 `RunResultPanel`，包括 Result Tabs 的方向键、Home 和 End 行为。
- 断言下拉框复用 `SearchableSelect`，支持搜索、方向键、Enter、Escape、IME 和焦点返回。
- 启用控件使用原生 checkbox 加 `role="switch"`，保留可访问名称、焦点态、禁用态和文字状态。
- 标签输入框继续由可见 label 关联，placeholder 仅承载格式提示。

## 6. 安全、兼容与迁移

- Run 详情仍经过现有服务端脱敏和客户端运行时解码；不把响应或 secret 写入 Toast、URL 或浏览器存储。
- 不新增依赖，不增加数据 migration，2.0.3 数据可直接使用。
- 回滚只需恢复前端代码和文案资源，不需要数据降级。

## 7. 自动化测试

- Foundation 测试覆盖 Switch 的语义、状态和点击切换。
- 自动化测试 Feature 测试覆盖标签 placeholder、启用 Switch、断言下拉搜索与稳定枚举值。
- 执行测试覆盖由关联 Run 加载并展示 Tool 调试同款响应面板。
- 完整交付门槛为 typecheck、全部 Vitest、生产 build 和 Playwright E2E。
- 2026-09-03 已通过 `npm run verify`：typecheck、118 个 Vitest 文件（853 项测试）、生产构建和 7 项 Playwright E2E 全部通过。

## 8. 发布与回滚条件

- 如果出现跨 project/执行串响应、响应未脱敏、断言枚举值改变、键盘无法操作或完整门禁失败，则停止发布。
- 本版本没有不可逆数据变化，可回滚前端产物。
