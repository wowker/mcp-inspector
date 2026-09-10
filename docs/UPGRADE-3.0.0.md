# MCP Inspector 3.0.0 升级规划：Authoring MCP

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Design approved；详细实施计划待编写 |
| 目标版本 | `3.0.0` |
| 当前代码版本 | `2.7.0` |
| 当前项目数据库基线 | migrations `001`–`020` |
| 更新日期 | 2026-09-09 |
| 正式设计规格 | [`superpowers/specs/2026-09-09-authoring-mcp-design.md`](./superpowers/specs/2026-09-09-authoring-mcp-design.md) |

> 本规划替换此前“Inspector 内置模型、Provider Adapter 和自治 Agent Loop”的方向。
> 3.0.0 不接入模型。Codex、Claude、Cursor 等外部 AI Host 通过本机
> Streamable HTTP 调用 Inspector 提供的 Authoring MCP 服务。

## 1. 产品目标

MCP Inspector 作为本机 Authoring MCP Server，向外部 AI 提供受控工具，使 AI 可以：

- 发现 Inspector 中配置好的项目、Server 和 Tools；
- 独立调用下游 Tool 排查问题；
- 创建和维护自动化 Draft；
- 生成 Tool 测试、场景测试、断言、参数映射和测试套件；
- 在 QuickJS 沙箱中完成步骤级参数转换；
- 校验和试运行 Draft；
- 将验证后的 Draft 原子保存为现有确定性测试资产。

目标是把繁复的自动化配置和脚本编写交给用户选择的外部 AI，同时保持
Inspector 对身份、权限、执行、审计、脱敏和持久化的最终控制。

## 2. 首版架构

```text
Codex / Claude / Cursor
        │ Streamable HTTP + Bearer Token
        ▼
http://127.0.0.1:8500/mcp/authoring
        │
        ▼
MCP Inspector 单进程
├── Authoring MCP Adapter
├── Authoring 权限与 Draft 服务
├── 现有 ConnectionRuntime / RunService
├── 现有测试、场景、套件与 QuickJS 执行器
├── registry.sqlite
└── projects/<projectId>/project.sqlite
        │
        ▼
用户配置的下游 MCP Servers
```

首版仅支持本机 loopback，不提供远程、局域网、云端或 stdio 接入。

## 3. 启动与端口

- 默认绑定 `127.0.0.1:8500`。
- Authoring endpoint 为 `/mcp/authoring`。
- 支持 `mcp-inspector --port 8501`。
- 保留 `MCP_INSPECTOR_PORT=8501`。
- 优先级为 `--port`、环境变量、默认值 `8500`。
- 端口不写入 SQLite。
- 端口占用时明确失败，不静默选择其他端口。
- 测试代码仍可显式使用端口 `0`。

## 4. 授权模型

Authoring MCP 使用独立、可轮换的安装级 Bearer Token，不复用浏览器 Session
或下游 Server 凭证。Token 摘要保存在 `registry.sqlite`，明文只在首次生成或
重新生成时显示。

每个 connection 使用独立权限策略：

```text
DISABLED     禁止 Authoring 调用
READ_ONLY    只允许用户确认的只读 Tools
CUSTOM       通过允许和拒绝列表控制
FULL_ACCESS  允许当前及以后出现的所有下游 Tools
```

`FULL_ACCESS` 是最高下游 Tool 权限，包括写入、删除、destructive 和没有安全
annotations 的 Tool。它仍不能绕过项目/连接身份、参数 Schema、审计、幂等、
限流、超时、脱敏、SQLite 隔离以及 Inspector 管理能力边界。

## 5. Authoring 工具集

首版提供固定、小型工具集，不把所有下游 Tool 动态注册成顶层 MCP Tools：

```text
inspector_get_capabilities
inspector_list_projects
inspector_list_connections

inspector_list_tools
inspector_describe_tool
inspector_call_tool
inspector_list_tool_calls
inspector_get_tool_call

inspector_create_draft
inspector_create_draft_from_call
inspector_list_drafts
inspector_get_draft
inspector_replace_draft
inspector_validate_draft
inspector_execute_draft
inspector_get_draft_execution
inspector_cancel_draft_execution
inspector_save_draft

inspector_list_test_assets
inspector_get_test_asset
```

`inspector_call_tool` 支持两种上下文：

- `STANDALONE`：独立调试和问题排查；
- `DRAFT`：自动化设计中的探索、setup、action、poll 或 cleanup。

两者都必须生成普通 Run 和 Authoring 调用记录。独立调用不要求先创建 Draft。

## 6. Draft 与正式资产

Draft 是现有测试资产的待保存版本，不是第二套执行引擎。一个 Draft Bundle
可以包含多个 Tool 测试、场景测试和测试套件，并用 Draft-local ID 建立引用。

Draft 的结构尽量复用现有共享 Schema：

- Tool target 与 arguments；
- 场景 inputs、steps 和 cleanup steps；
- fixed arguments、mappings 和 extractors；
- assertions、condition、polling 和 failure policy；
- Suite members、concurrency 和 stop-on-failure；
- 新增受限的步骤级 QuickJS `argumentTransform`。

新建正式测试统一为未启用。编辑已有资产时保留原启用状态；Authoring MCP
不能启用测试、创建定时任务或删除正式资产。

## 7. 校验、执行与保存

- Draft 更新使用 `expectedRevision`。
- 校验记录绑定 `draftId + revision + definitionDigest + toolSchemaHashes`。
- Draft 试运行异步返回 execution ID，并通过查询/取消工具管理。
- 每个真实 Tool 调用继续进入现有 Run 体系。
- 写调用支持副作用和 cleanup 关联；`FULL_ACCESS` 不阻止调用，Draft 的 cleanup
  要求由独立策略控制。
- 保存必须携带最新 revision、validation digest 和 idempotency key。
- 一个 SQLite transaction 创建所有测试、revision、套件、成员和 Apply 映射。
- 任一步失败完整回滚，Draft 保持可编辑。

## 8. UI 入口

左侧增加 `Authoring MCP` 页面，提供：

- 服务状态、endpoint、复制客户端配置和 Token 设置；
- Draft 列表与详情；
- Authoring Tool 调用列表与详情；
- 打开现有测试用例和测试套件编辑器；
- 校验、试运行和保存入口。

Server 编辑区增加 `Authoring MCP 权限` Disclosure。运行历史增加 Authoring
来源筛选。Authoring 页面在菜单切换时保持筛选、选中项、滚动位置和 Draft
编辑状态，切换项目时必须清除旧项目状态。

## 9. 数据库升级

安装级 `registry.sqlite` 增加独立迁移体系和 Authoring 设置。项目数据库继续
沿用现有编号：

```text
registry migrations
001_registry_baseline.sql
002_authoring_settings.sql

project migrations
021_authoring_connection_policies.sql
022_authoring_drafts.sql
023_authoring_tool_calls.sql
```

步骤级 QuickJS 保存在测试 revision JSON 中，通过向后兼容的共享 Schema
扩展实现，不需要单独数据库列。

## 10. 安全边界

- 只监听 IPv4 loopback；首版不允许 `0.0.0.0`。
- `/mcp/authoring` 每次请求验证 Authoring Token。
- 禁止 CORS，并校验请求携带的 Origin。
- Authoring 输出始终强制脱敏，不受普通 Run 脱敏开关影响。
- Tool 描述、Schema、响应和 AI 生成配置全部按不可信输入处理。
- QuickJS 无网络、文件系统、Node API、环境明文或 Tool 调用能力。
- 非幂等写调用结局不确定时标记 `UNKNOWN`，禁止自动重试。
- 所有错误使用稳定错误码，不返回 stack、SQL、文件路径或凭证。

## 11. 分阶段交付

1. 固定端口、registry migration、Token 与 MCP transport。
2. 项目/连接/Tool 发现、四级权限与 Server 权限 UI。
3. 独立 Tool 调用、调用历史和运行历史来源。
4. Draft Bundle、revision/digest、校验和 Authoring 工作区。
5. Draft 异步试运行、步骤级 QuickJS、副作用和中断恢复。
6. 原子 Apply、正式资产映射和现有编辑器跳转。
7. 安全、并发、i18n、无障碍、E2E 和发布门禁。

## 12. 首版明确不做

- Inspector 内置模型、Provider 配置或聊天页面；
- stdio bridge；
- 远程和局域网 Authoring endpoint；
- 多用户、多角色或多 Token；
- AI 创建压力测试；
- AI 修改共享 Tool before/after 脚本；
- AI 管理 Secret、Server 认证或环境变量；
- AI 删除资产、启用测试或创建定时任务。

完整接口、数据模型、错误语义、安全控制和验收矩阵以正式设计规格为准。
