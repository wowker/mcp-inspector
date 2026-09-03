# MCP Inspector 2.0.3 更新计划

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Implemented，完整质量门禁已通过 |
| 目标版本 | `2.0.3` |
| 当前代码基线 | `2.0.0` |
| 前置版本 | [MCP Inspector 2.0.2 更新计划](./UPGRADE-2.0.2.md) |
| 更新日期 | 2026-09-03 |
| 适用范围 | Tools 调试、自动化测试、测试套件、Tool Tab 路由、国际化与无障碍 |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |
| 领域规范 | [1.5.0 自动化测试设计与开发规范](./AUTOMATED-TESTING-1.5.0.md) |

> 2.0.3 是自动化测试可用性与 Tool Tab 生命周期修复版本。它不新增 SQLite migration，
> 不改变 Connection、Tool Tab、Run、测试定义、套件成员或执行报告的持久化身份。

## 1. 交付目标

1. 在断言标题后提供帮助入口，说明断言用途、配置步骤和引擎真实支持的语法。
2. 修复测试套件保存文案与静默失败，并让成员添加、启停和移除成为清晰的双栏流程。
3. 在 Tools 调试参数栏直接把当前 Tool 和参数保存为单 Tool 测试用例。
4. 将测试用例保存失败从无原因摘要改为可操作说明，同时保留当前草稿。
5. 修复离开 Tools 再返回时重复消费旧 Tool 打开意图、创建重复 Tab 的问题。

## 2. 用户流程

### 2.1 断言说明

- “断言”标题后的 `?` 使用共享 `ModuleHelpPopover`。
- 内容解释数据源、操作符、JSON 期望值，以及以 `$` 开头的受控 JSONPath 子集。
- 示例与断言引擎保持一致：`$.structuredContent.items[0].id`、`$["field-name"]`；空路径或 `$` 代表整个数据源。
- Popover 支持键盘打开、Escape/点击外部关闭和焦点返回，并同时提供中英文内容。

### 2.2 测试套件保存与成员绑定

- 保存按钮固定显示“保存测试套件”，不复用测试用例文案。
- 名称为空或尚未添加成员时，点击保存会说明缺失项和草稿保留状态，不再无响应。
- 成员区域分为“可添加的测试用例”和“已添加成员”：候选区支持搜索和添加，成员区支持启停与移除。
- 场景成员继续按稳定 member ID 保存本次执行输入；成员顺序、connection ID 和执行隔离语义不变。

### 2.3 Tools 直接保存测试用例

- Tools 参数工具栏增加“保存为测试用例”。
- 保存内容包含当前 project、connection、Tool 和 canonical arguments；默认启用，断言为空，超时为 30 秒。
- 疑似凭证字段和 `[REDACTED]` 值在写入测试定义前剔除，并明确提示用户改用环境变量引用。
- 同一 Tab 保存请求未完成时阻止重复提交；失败时当前 Tool 参数和 Tab 均保持不变。

### 2.4 保存失败原因

- `TEST_CASE_REVISION_CONFLICT`：说明 revision 已被更新，建议刷新并合并后重试。
- `TEST_CASE_INVALID`：提示检查名称、目标、参数、断言与超时。
- `TEST_TARGET_NOT_AVAILABLE`：提示重新连接 Server 或选择可用 Tool。
- 未识别错误：提示检查本地服务和网络；不直接暴露底层异常或敏感信息。
- 所有失败文案都明确说明草稿已保留。

## 3. Tool Tab 重复创建修复

Tool Catalog、运行历史等入口继续通过带递增 sequence 的一次性 Tool intent 打开或恢复 Tab。`DebugWorkspace` 接受并排队该 intent 后立即通知工作台清除相同 sequence；异步打开仍按 project、connection 和 workspace generation 校验。这样页面卸载后再次进入 Tools 时只从服务端恢复已有 Tab，不会再次执行旧 intent。

## 4. 状态、安全与兼容

- 保持 project、connection、tab、run 和 suite member 身份隔离。
- 不把凭证、疑似 secret、底层异常或原始服务端 payload 写入 Toast、URL 或浏览器存储。
- 不修改测试用例与测试套件 API、共享 wire schema 或数据库表。
- 新增 UI 使用现有 token、Phosphor 图标、Button、Popover 和 Toast，不引入依赖或第二套设计系统。
- 中英文 key 严格对称；按钮、搜索框、成员区和帮助 Popover 均提供可访问名称。

## 5. 自动化测试与验收

- 组件测试覆盖断言帮助内容与真实 JSONPath 示例。
- Feature 测试覆盖套件成员添加、保存文案、空成员反馈、保存请求体和失败草稿保留。
- Debug Workspace 测试覆盖直接保存、敏感字段剔除和重复点击保护。
- Workbench 测试覆盖“打开 Tool → 自动化测试 → 返回 Tools”只创建一次 Tab。
- 2026-09-03 已通过 `npm run verify`：typecheck、118 个 Vitest 文件（843 项测试）、生产构建和 7 项 Playwright E2E 全部通过。

## 6. 发布与回滚

- 2.0.3 不需要数据迁移；回滚只需恢复前端实现。
- 如果发现 Tool Tab 重复创建、跨 connection 保存、secret 写入测试定义、套件成员丢失或完整验证失败，则停止发布。
