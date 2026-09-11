# MCP Inspector

<p align="center">
  一款本地优先的 MCP Tool 检查、调试、测试、回放与安全自动化编排工作台。
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wuwei0215/mcp-inspector"><img alt="npm 版本" src="https://img.shields.io/npm/v/%40wuwei0215%2Fmcp-inspector"></a>
  <img alt="Node.js 22 或更高版本" src="https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white">
  <img alt="MCP 传输协议：Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable_HTTP-5A67D8">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white">
</p>

![MCP Inspector Tool 调试工作台](https://raw.githubusercontent.com/wowker/mcp-inspector/main/e2e/core-debugger.spec.ts-snapshots/tool-debug-zh-light-darwin.png)

MCP Inspector 完全运行在你的电脑上，为开发者、测试人员和 AI Agent 构建者提供类似 API 客户端的 MCP Server 操作界面。你可以连接 Streamable HTTP Server、检查 Tool 目录与 Schema、执行调用并保留协议级证据、构建确定性自动化测试、执行受控压力测试，还可以向外部 AI Host 提供受权限策略保护的 Authoring MCP 端点。

应用始终只绑定 `127.0.0.1`。项目、连接、Tab、草稿、Run、测试资产和协议事件均保存在本机 SQLite 数据库中。

## 目录

- [为什么选择 MCP Inspector](#为什么选择-mcp-inspector)
- [功能总览](#功能总览)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [核心工作流](#核心工作流)
- [Authoring MCP](#authoring-mcp)
- [安全模型](#安全模型)
- [当前限制](#当前限制)
- [开发与验证](#开发与验证)
- [项目结构](#项目结构)
- [项目文档](#项目文档)
- [参与贡献](#参与贡献)
- [安全问题报告](#安全问题报告)
- [许可证](#许可证)

## 为什么选择 MCP Inspector

- **本地优先：** 应用数据保留在运行 Inspector 的电脑上。
- **理解协议：** 同时查看格式化结果、原始 MCP 响应、JSON-RPC、HTTP 摘要和有序事件时间线。
- **身份隔离：** 即使多个 Server 使用同一 URL，项目、连接、Tool、Tab、Run 和测试身份也不会混用。
- **面向测试：** 将探索性调用沉淀为可复用请求、确定性测试用例、场景、套件、报告和压力测试。
- **支持 AI Agent：** 让 Codex、Claude、Cursor 等 MCP Host 在受控策略下发现已授权下游 Tool 并创建测试 Draft。
- **双语与可访问：** 支持英文/简体中文、明暗主题、响应式布局和以键盘为中心的操作方式。

## 功能总览

### 项目、Server 与认证

- 创建并切换相互隔离的本地项目。
- 保存多个 Streamable HTTP MCP Server 连接。
- 支持无认证、Bearer Token、自定义请求 Header 和浏览器 OAuth。
- OAuth 包含 PKCE、受保护资源发现、动态客户端注册和浏览器授权。
- 导入、导出 Server 配置，并始终隐藏 Secret 值。
- 在 Bearer Token 和自定义 Header 中引用项目或 Server 作用域环境变量。
- 认证始终按准确的 Connection ID 绑定，绝不只按 URL 或域名匹配。

### Tool 目录与 Schema 检查

- 获取、刷新、搜索、筛选、分页、收藏 Tool，并使用本地文件夹整理目录。
- 按全部、收藏、最近使用、已变更或已移除筛选 Tool。
- 保存不可变的 Tool 定义快照，标识当前、已变更和已移除状态。
- 查看描述、输入/输出 Schema、行为注解、图标、协议扩展、Schema Hash 和快照历史。
- 识别 JSON Schema Draft 2020-12 与 Draft 7，并对未知方言给出警告。

### 参数编辑与 Tool 调试

- 使用 Schema Form 或 Raw JSON 编辑参数。
- 支持嵌套对象、对象数组、枚举、布尔值、JSON 子树、额外属性和 Schema 分支。
- 执行前校验必填项、类型、格式、正则、范围、长度及其他 Schema 约束。
- 搜索和筛选字段、展开长描述、格式化/复制 JSON，并使用放大版 JSON 编辑器。
- 为同一个 Tool 打开多个隔离且可恢复的 Tab；支持固定、复制、排序和批量关闭，草稿互不干扰。
- 提供请求优先、平衡和结果优先三种分栏布局。

### 已保存请求与响应

- 为每个 Tool 保存命名的请求和响应内容。
- 将已保存请求重新载入当前调试 Tab。
- 复制已保存 JSON，或直接从已保存内容创建测试用例。
- 详情按需加载，大型内容不会拖慢列表。

### Run 历史、回放与对比

- 保存每次 Tool 调用的参数、结果、状态、耗时、连接、Tool 快照、调用来源和有序协议事件。
- 查看格式化输出、Raw 响应、JSON-RPC、HTTP Trace 摘要和脚本流水线详情。
- 使用稳定游标分页浏览项目历史或当前 Tab 历史。
- 按 Tool 名称、Call ID、状态、Server、调用来源、固定状态和时间范围搜索筛选。
- 固定重要 Run，并可启用有边界的定时刷新。
- 在只读 Tab 中打开历史 Run，避免误触再次调用 Tool。
- 仅在显式确认后回放已完成 Run；使用来源 Run 的原始 Connection ID 和参数，并匹配当前 Tool 定义。
- Schema 漂移和潜在破坏性副作用分别确认；回放不会静默重试或跨 Server 执行。
- 对回放 Run 与直接来源 Run 做有界结构化对比，并配置项目级 JSONPath 忽略规则。

### 环境变量与 Profile

- 在项目和 Server 作用域定义 JSON 值环境变量。
- 将变量标为 Secret，使其不出现在列表、预览、日志、导出和持久化 Run 证据中。
- 使用 `{{VARIABLE_NAME}}` 模板在连接凭据和工作流配置中引用标量变量。
- 创建可继承的环境 Profile，覆盖或取消变量、预览最终继承链，并为每个 Server 选择当前 Profile。
- 脚本流水线成功后，原子提交项目/Server 变量变更。

### Tool 前置与后置脚本

- 为单个 Tool 配置相互隔离的 `before` 与 `after` JavaScript。
- 主调用前修改参数，调用成功后读取完整响应。
- 调用已授权辅助 Tool、使用临时变量、查询确定性 JSON 路径、执行断言并输出结构化日志。
- 只校验语法，或对单个阶段试运行而不调用主 Tool。
- 在独立 QuickJS 进程中执行 ES2022，不能访问 Node.js、网络、文件系统、动态 import、`eval` 或宿主全局对象。
- 限制超时、内存、栈、日志大小/数量和辅助 Tool 调用次数。
- 可取消流水线；任一阶段失败时不提交暂存环境变量。

脚本入口示例：

```js
export default async function before(ctx) {
  const profile = await ctx.tools.call({
    server: "current",
    name: "get_account_profile",
    arguments: {},
  });

  ctx.arguments.set(
    "account_id",
    ctx.json.get(profile, "$.structuredContent.account_id"),
  );
  ctx.log.info("Account prepared");
}
```

脚本 SDK 包含 `ctx.arguments`、`ctx.tools`、`ctx.response`、`ctx.variables`、`ctx.env`、`ctx.json`、`ctx.assert` 和 `ctx.log`。

### 自动化测试

- 创建带版本的单 Tool 与多步骤场景测试用例。
- 对 Run、MCP 结果/错误、HTTP 元数据、工作流结果或场景变量添加声明式断言。
- 支持存在性、相等、子集、字符串、数值、长度、数组、类型、Schema、状态、错误状态和耗时操作符。
- 断言期望值既可使用字面量，也可读取已提取的场景变量。
- 将场景输入、常量、上一步输出和环境变量映射为后续 Tool 参数。
- 转换参数、提取响应值、轮询直到条件满足，并执行清理步骤。
- 保留步骤、尝试、Run、Workflow、取消、跳过和清理链路。
- 将 Tool/场景用例组成套件，配置有限并发和失败时停止。
- 预览测试调用，并为破坏性范围要求显式确认。
- 使用版本化 JSON 导入导出测试定义；完整校验包内容、处理冲突并逐个重绑定 Server。
- 仅通过显式、版本安全的操作更新断言基线。

### 测试报告

- 浏览项目级和套件级执行历史。
- 按套件成员、调用记录和单个完整 Tool 结果浏览报告。
- 查看最终参数、断言结果、错误、耗时和对应 Run/Workflow 链路。
- 保存 `1.0`、`2.0` 等不可变命名报告版本，不重复复制请求或响应内容。
- 编辑已保存版本的元数据，并按套件、状态、保存状态或版本标签筛选。

### 受控压力测试

- 使用 1–20 个虚拟用户重复执行一个已保存测试用例。
- 配置升压时间、持续时间、思考时间、迭代上限和受控取消。
- 校验最大错误率、p95 耗时和最低每秒请求数。
- 可在错误率超过阈值时提前停止。
- 查看实时进度、样本链路、吞吐、错误统计，以及 min/average/p50/p90/p95/p99/max 耗时。
- 每次执行都快照准确的压力测试和目标测试版本。

### 面向外部 AI Host 的 Authoring MCP

- 将 Inspector 自身作为 `/mcp/authoring` 本地 Streamable HTTP MCP Server 运行。
- 提供固定 Tool 集，支持能力发现、项目/Server/Tool 目录访问、可审计独立调用、Draft 编写、确定性校验、异步试运行、取消和原子保存。
- 从已有测试资产或经过脱敏的 Authoring 调用创建 Draft。
- 将已验证 Draft 保存为默认停用的 Tool 测试、场景和套件；AI 无权启用、删除、定时或管理 Secret。
- 为每个连接配置 `DISABLED`、`READ_ONLY`、`CUSTOM` 或 `FULL_ACCESS`，以及允许/拒绝列表和安全限制。
- 强制执行 Schema Hash、Revision、幂等 Key、频率/并发限制、超时、强制脱敏和完整调用链路。
- 在浏览器工作台中查看 Authoring 设置、Draft 和调用记录。

## 环境要求

- Node.js 22 或更高版本
- npm
- 仅在运行端到端测试时需要 Google Chrome

MCP Inspector 当前支持 Streamable HTTP MCP Server，不会替你启动或管理下游 Server 进程。

## 快速开始

直接运行 npm 最新版本：

```bash
npx --yes @wuwei0215/mcp-inspector@latest
```

也可以从源码安装：

```bash
git clone https://github.com/wowker/mcp-inspector.git
cd mcp-inspector
npm install
npm run build
npm start
```

Inspector 会打开本地浏览器并监听 `127.0.0.1:8500`。需要更换可用端口时：

```bash
mcp-inspector --port 8501
# 或
MCP_INSPECTOR_PORT=8501 mcp-inspector
```

优先级为 `--port`、`MCP_INSPECTOR_PORT`、固定默认值 `8500`。端口不可用时会明确失败，不会静默切换到其他端口。

源码仓库也提供 Makefile，可安装缺失依赖、重新构建和管理后台进程：

```bash
make          # 等同于 make restart
make status
make logs     # Ctrl-C 停止跟随日志
make stop
```

## 核心工作流

### 连接并调用 Tool

1. 创建或选择一个项目。
2. 添加 Server 连接并选择认证方式。
3. 连接 Server 并刷新 Tool 目录。
4. 选择 Tool，在 Form 或 Raw JSON 中填写参数并执行。
5. 检查结果与协议时间线，然后保存有价值的请求/响应或转换为测试。

### 将探索调用沉淀为回归测试

1. 将 Tool 调用保存为测试用例，或将多个步骤组合成场景。
2. 添加确定性断言、映射、轮询和清理策略。
3. 把测试加入套件并选择有限并发。
4. 执行套件、检查报告，保存重要报告版本或显式更新基线。
5. 需要可重复性、延迟、吞吐和错误率证据时，执行受控压力测试。

## Authoring MCP

在左侧导航启用 **Authoring MCP**，复制只显示一次的 Token，并为每个下游 Server 授予最小必要权限。默认端点：

```text
http://127.0.0.1:8500/mcp/authoring
```

MCP Host 配置示例：

```json
{
  "mcpServers": {
    "mcp-inspector-authoring": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8500/mcp/authoring",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

Token 必须放在 `Authorization` Header 中，不能放进 URL。它只会在首次启用 Authoring MCP 或轮换 Token 时显示。

Authoring Tool 列表：

| 分类 | Tool |
| --- | --- |
| 能力 | `inspector_get_capabilities` |
| 发现 | `inspector_list_projects`、`inspector_list_connections`、`inspector_list_tools`、`inspector_describe_tool` |
| 可审计调用 | `inspector_call_tool`、`inspector_list_tool_calls`、`inspector_get_tool_call` |
| Draft | `inspector_create_draft`、`inspector_create_draft_from_call`、`inspector_list_drafts`、`inspector_get_draft`、`inspector_replace_draft` |
| 校验与试运行 | `inspector_validate_draft`、`inspector_execute_draft`、`inspector_get_draft_execution`、`inspector_cancel_draft_execution` |
| 正式资产 | `inspector_save_draft`、`inspector_list_test_assets`、`inspector_get_test_asset` |

完整权限、错误和生命周期契约见 [3.0.0 Authoring MCP 规范](./docs/UPGRADE-3.0.0.md)。

## 安全模型

- 应用和 Authoring 端点只绑定回环地址 `127.0.0.1`。
- 每次启动都会生成新的随机浏览器 Session Token；首次进入后 Bootstrap URL 会被替换，Token 只保留在当前 Tab 的 Session Storage。
- OAuth Access Token 仅保存在 Inspector 进程内，不写入 SQLite、导出或浏览器存储。
- Secret 不进入 URL、普通日志、Toast、默认导出和持久化证据。
- 每个边界都会校验项目、连接、Tab、Run 和测试身份。
- 回放必须显式触发、绑定来源连接、不自动重试，并对 Schema 漂移和破坏性副作用加保护。
- 脚本在有资源限制的独立 QuickJS 进程中执行。
- Authoring MCP 使用只显示一次的 Bearer Token、连接级权限、强制脱敏、有界响应和可审计调用。
- SQLite Migration 只能新增；已发布 Migration 永不重写。

MCP Tool 可能产生真实外部副作用。Inspector 提供确认和安全边界，但无法回滚下游 Tool 已经造成的业务变更。

## 当前限制

- 下游连接只支持 Streamable HTTP，暂不支持 stdio 和旧版 SSE Transport。
- OAuth Access Token 刻意只保存在内存中，因此重启后需要重新授权。
- 回放对比仅支持回放 Run 与其直接来源 Run，不支持任意两个 Run。
- 缺失、运行中、失败、截断、损坏或非 JSON 的结果不能进入结构化对比。
- 脚本 JSON 路径使用确定性子集，不是完整 JSONPath 语言。
- 压力测试有意设置严格上限，不能代替分布式压测平台。
- Inspector 是本地工作台，不是托管式多用户服务或 Secret Manager。

## 开发与验证

开发模式同时启动 API 与 Vite 客户端：

```bash
npm install
npm run dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 检查客户端与服务端 TypeScript 类型 |
| `npm test` | 运行 Vitest 单元与集成测试 |
| `npm run build` | 构建生产客户端与服务端 |
| `npm run test:e2e` | 构建并在 Chrome 中运行 Playwright 测试 |
| `npm run verify` | 执行类型检查、串行 Release 测试、生产构建和 E2E |
| `npm run verify:release-artifacts` | 校验构建预算、Migration 完整性和 npm 包内容 |

核心工作流、认证、持久化、路由、布局或生产入口变更在合并前必须通过 `npm run verify`。

## 项目结构

```text
src/
├── client/       React 工作台、功能页面、共享 UI 与国际化
├── server/       Hono API、MCP Client、服务、SQLite Repository 与 Authoring MCP
└── shared/       客户端/服务端复用的运行时 Schema 与契约
e2e/              Playwright 工作流、可访问性检查与视觉快照
docs/             功能规范、升级说明、评审与架构决策
scripts/          开发、构建、发布和产物校验脚本
test-support/     本地 MCP Fixture 与对抗测试辅助工具
```

技术栈包括 TypeScript、React 19、Hono、Model Context Protocol SDK、SQLite（`better-sqlite3`）、Zod、AJV、QuickJS、Vitest 和 Playwright。

## 项目文档

- [前端开发规范](./docs/FRONTEND-DEVELOPMENT-STANDARDS.md)
- [自动化测试设计](./docs/AUTOMATED-TESTING-1.5.0.md)
- [Tool 脚本工作流](./docs/SPEC-tool-script-workflows.md)
- [环境 Profile](./docs/ENVIRONMENT-PROFILES-2.0.md)
- [测试套件执行报告](./docs/UPGRADE-2.5.0.md)
- [受控压力测试](./docs/UPGRADE-2.5.1.md)
- [Authoring MCP](./docs/UPGRADE-3.0.0.md)
- [内部 UI Foundation 决策](./docs/decisions/001-internal-ui-foundation.md)
- [更新日志](./CHANGELOG.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。修改 UI、交互、客户端状态、CSS、可访问性或浏览器行为前，请先阅读[前端开发规范](./docs/FRONTEND-DEVELOPMENT-STANDARDS.md)。请保持项目与连接身份隔离，避免 Secret 进入持久化或浏览器可见区域，复用共享运行时 Schema，为行为变更添加回归测试，并执行与变更相匹配的验证。

典型的小范围贡献流程：

```bash
git checkout -b feature/short-description
npm install
npm run dev
npm run verify
```

请保持 Commit 范围单一，并在说明中写明用户可见结果和已执行的验证。

## 安全问题报告

请勿在公开 Issue 中提交凭据、Token、私有 MCP 响应或漏洞利用细节。安全相关问题请先通过 GitHub 私下联系仓库维护者，再进行公开披露。

## 许可证

当前仓库尚未包含软件许可证。在维护者正式添加许可证前，版权仍归项目作者所有，默认不授予再分发权限。
