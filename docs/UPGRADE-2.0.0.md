# MCP Inspector 2.0.0 升级规划

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Proposed，进入实施前需要按里程碑确认 |
| 目标版本 | `2.0.0` |
| 当前基线 | `1.0.4` |
| 更新日期 | 2026-08-28 |
| 适用范围 | Web UI、Hono API、SQLite 数据、CLI、导入导出和自动化测试 |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |

> 版本关系：自动化测试的领域模型、单 Tool 用例、场景编排和测试套件已提前规划到
> [1.5.0 自动化测试设计与开发规范](./AUTOMATED-TESTING-1.5.0.md)。2.0.0 在兼容
> 1.5.0 数据与 API 的前提下继续完成 UI Foundation、运行比较和环境配置集升级；不重复
> 定义另一套测试模型。

## 1. 升级摘要

2.0.0 将 MCP Inspector 从“能够完成单次 Tool 调试的工作台”升级为“可组织、复现、比较和自动验证 MCP Tool 调用的本地测试平台”。

本次升级不重新设计 MCP 调用链路，也不替换已经稳定的 Hono、SQLite、MCP Client、QuickJS 和 React 技术栈。升级重点是：

1. 收敛高密度工作区的 UI 层级和滚动模型。
2. 建立可复用、可测试的内部 UI 组件规范。
3. 把已保存请求、响应和运行历史提升为可执行测试用例。
4. 增加运行比较、环境配置集和自动化测试能力。
5. 保持 Server 身份、认证信息、Tool Tab、Run 轨迹和脚本流水线相互隔离。

## 2. 产品定位

MCP Inspector 2.0 是面向开发、测试和排障人员的 MCP DevTools。它不是营销型网站，也不是通用后台管理系统。

设计参数：

| 参数 | 目标 |
|---|---:|
| 视觉变化度 | 4 / 10 |
| 动效强度 | 2 / 10 |
| 信息密度 | 8 / 10 |
| 首要设备 | 桌面浏览器 |
| 最低完整工作区宽度 | 1024px |
| 主题 | 浅色、深色，同等能力 |

产品体验必须满足：

- 同一屏幕可完成选择 Tool、编辑参数、执行、查看结果和检查协议轨迹。
- 每一个执行结果都可以回溯到 Server、Tool 快照、参数、脚本和协议事件。
- 多 Server、多 Tool Tab 和并发 Run 之间不得串状态、串认证或串结果。
- 密集信息通过层级、分区和折叠组织，不通过大量卡片制造空间浪费。

## 3. 2.0.0 目标

### 3.1 必须交付

#### A. UI 基础层

- 建立内部 UI primitives：按钮、图标按钮、分段选择、页签、状态标签、表单字段、弹层、表格、Disclosure、Split Pane、Toast、JSON Viewer。
- 将全局样式按 token、layout、component、feature、theme 分层。
- 统一浅色和深色主题的颜色、边框、交互态和 overlay。
- 固定工作台滚动所有权，禁止页面根节点与内部面板同时滚动。
- 保留 Phosphor Icons 和 Primer semantic tokens，不再引入第二套图标或视觉体系。

#### B. 调试工作区

- 明确“产品模块、Server、Tool Tab、Tool 局部视图、结果视图”五级信息层级。
- 参数区与结果区支持拖拽、最大化、恢复和布局预设。
- 按 Tool Tab 记忆 Form/Raw、折叠状态和 Split Pane 比例。
- Tool Catalog 支持收藏、最近使用、定义变化和已移除筛选。
- 大型 Tool Catalog 使用虚拟列表或等价的有界渲染方案。
- Form 和 Raw JSON 始终由同一 canonical arguments 驱动。
- 复杂 Schema 提供可理解的字段编辑，不因可支持的组合结构直接退化为完整 JSON。

#### C. 结果与轨迹

- 结果区统一为状态栏、横向页签和内容区。
- 大型 JSON 支持搜索、展开深度、全部展开/收起、复制节点、复制 JSONPath 和放大查看。
- HTTP、RPC、时间线和脚本流水线使用一致的事件行和详情结构。
- UI 文案使用“发送/接收”解释 `rpc-out`、`rpc-in`，保留协议术语作为辅助信息。
- 所有失败提供稳定错误码、用户说明和“复制诊断信息”。

#### D. 测试用例体验升级

- 兼容并复用 1.5.0 的测试用例、场景、套件、断言和执行历史。
- 将保存请求/响应、Run 与测试用例之间的转换入口迁移到统一 UI Foundation。
- 增强大型用例列表、场景编排器、断言结果和测试报告的可视化体验。
- 支持从 Run 创建用例、从用例打开新 Tool Tab、执行后更新基线。
- 基线更新必须显式确认，不允许成功执行后自动覆盖。

#### E. 运行比较

- 支持同一 Tool 的两个 Run 比较。
- 比较参数、结构化响应、HTTP、RPC、Tool 快照、脚本日志和耗时。
- 敏感字段在比较结果中继续遵循所属 Server 的脱敏配置。

#### F. 环境配置集

- 在项目变量和 Server 变量之上增加环境配置集，例如开发、测试、预发。
- 支持环境继承、缺失变量检查、冲突来源说明和最终解析值预览。
- Header、Bearer Token 和脚本只保存变量引用，不复制变量值。
- 导出默认不包含敏感变量明文。

### 3.2 2.x 后续版本

以下能力不阻塞 2.0.0 GA，可在 2.1 及以后交付：

- 测试套件、批量运行和有限并发。
- CLI 无界面运行测试用例并输出 JSON/JUnit 报告。
- OAuth 调试器，包括 metadata、scope、到期时间、刷新和 challenge 时间线。
- 脚本单步执行、Watch、参数差异和辅助 Tool 调用栈。
- 版本化工作区分享包和导入变更预览。
- MCP Resources、Prompts 和其他协议能力。

### 3.3 非目标

- 不迁移到 Electron 或桌面原生壳。
- 不把本地 SQLite 改造成远程多租户数据库。
- 不在 2.0.0 引入账号、云同步或团队权限系统。
- 不替换 MCP SDK 或创建私有 MCP 方言。
- 不为了视觉重构改写稳定的运行记录和连接生命周期。
- 不默认持久化 OAuth access token。

## 4. 信息架构

### 4.1 一级导航

一级导航只表示产品模块：

1. Servers
2. Tools
3. 环境变量
4. 测试用例
5. 运行历史

Resources、Prompts 等后续能力进入独立一级模块，不塞进 Tools 页面。

### 4.2 Tools 工作区

```text
应用侧边栏
└── Server 上下文栏
    └── Tool Catalog
        └── Tool 工作区 Tab
            ├── 调试
            ├── Tool 定义
            ├── 脚本
            ├── 测试用例
            └── 当前 Tool 历史
                └── 结果面板
                    ├── 脚本流水线（按需）
                    ├── 请求与结果
                    ├── 调用详情
                    ├── HTTP
                    ├── RPC
                    └── 时间线
```

各层级不得使用相同的激活样式。Server 使用底部指示线，Tool Tab 使用工作区页签，局部视图使用紧凑文字页签，结果视图使用固定结果导航。

## 5. 技术策略

### 5.1 保留的技术栈

- React 19 + TypeScript
- Vite + tsup
- Hono + Node.js 22
- better-sqlite3
- MCP Client SDK
- Zod + Ajv
- QuickJS sandbox
- Vitest + Testing Library + Playwright
- Phosphor Icons
- Primer tokens/primitives

### 5.2 前端模块边界

2.0.0 采用以下目标结构，允许渐进迁移：

```text
src/client/
├── api/                 # 防御性 API client 和解码
├── app/                 # Shell、路由、主题、全局组合
├── components/
│   ├── actions/         # Button、IconButton、Toolbar
│   ├── data-display/    # Status、Table、JSON、Log、EmptyState
│   ├── feedback/        # Toast、Alert、Progress
│   ├── forms/           # Field、Select、Radio、Switch、SecretInput
│   ├── layout/          # SplitPane、Tabs、Disclosure、ScrollRegion
│   └── overlays/        # Dialog、Popover、Tooltip
├── features/            # 业务功能，只组合组件和领域状态
├── hooks/               # 通用交互 hook
└── styles/
    ├── tokens.css
    ├── reset.css
    ├── primitives.css
    └── utilities.css
```

现有 `redesign.css` 不一次性重写。每次改动将相关样式迁移到对应组件或 feature，迁移完成后删除旧选择器。

### 5.3 状态所有权

- Server 连接状态由连接 runtime 和 API 结果决定。
- Tool Catalog 以 `projectId + connectionId` 为身份边界。
- Tool Tab 以持久化 `tabId` 为身份边界。
- Run 以 `runId` 为身份边界，查看历史不得修改活动 Run 状态。
- OAuth、Bearer Token、自定义 Header 必须绑定 connection ID，不得按 URL 复用。
- UI 局部状态不可覆盖服务端持久化事实。

## 6. 数据与兼容性

### 6.1 SQLite migration

2.0.0 需要新增数据表时必须：

- 只增加新 migration，不修改已经发布的 migration 文件。
- migration 可重复检测但只执行一次。
- 新表和外键继续使用 project scope。
- 数据迁移失败时停止启动，不允许部分打开工作区。
- 发布产物内 migration 必须与 source byte-match。

预期新增领域：

- UI workspace preferences
- Tool favorites/recent usage
- environment profiles
- test cases/assertions
- test suites（可延后）

### 6.2 导入导出

2.0 使用版本化 envelope：

```json
{
  "format": "mcp-inspector-workspace",
  "version": 2,
  "exportedAt": "2026-08-28T00:00:00.000Z",
  "data": {}
}
```

规则：

- 1.x 导出必须可以导入 2.0。
- 2.0 导入先校验再写入，并展示变更预览。
- 未知版本拒绝导入，不猜测字段含义。
- secret 默认剔除；显式包含时必须再次确认并标注风险。
- 失败导入不得留下半写入数据。

### 6.3 API 兼容

- 现有 1.x endpoint 在 2.0 内继续工作，除非有单独迁移说明。
- 新响应字段必须是向后兼容的可选字段。
- client 对成功响应继续执行运行时解码。
- 服务端错误继续使用稳定 error code，不把底层异常直接暴露给 UI。
- 破坏性 API 变化需要独立 ADR 和迁移期。

## 7. 安全要求

- Inspector 继续只监听显式 `127.0.0.1`。
- 每次启动使用高强度随机会话令牌。
- Origin 和会话令牌校验保持强制。
- OAuth token 默认只保存在进程内。
- Server 关闭脱敏时，只影响该 Server 的记录显示，不影响其他 Server。
- 环境变量、Header、Bearer Token 的变量引用在调用时解析。
- secret 不进入 URL、错误文本、Toast、普通日志或默认导出。
- JSON Viewer、日志和 Tool 描述只作为文本渲染，不执行 HTML。
- 脚本继续运行在 QuickJS 子进程沙箱，不获得 Node、文件系统和任意网络权限。

## 8. 性能预算

| 项目 | 2.0 预算 |
|---|---|
| 首屏主 JS gzip | 不高于 220 kB，超出需说明和拆包方案 |
| 首屏 CSS gzip | 不高于 70 kB |
| Tool 列表 | 1,000 个 Tool 仍可流畅搜索和滚动 |
| JSON Viewer | 10 MB 响应不阻塞主线程超过可感知时长；超限时采用摘要/虚拟化 |
| 输入响应 | 常规交互在 100 ms 内提供视觉反馈 |
| 动效 | 仅 transform/opacity，默认 120–180 ms |

大型 JSON Viewer、脚本编辑器和对比视图必须懒加载。新增依赖需要记录 bundle 影响。

## 9. 可访问性

- 所有功能可通过键盘完成。
- 使用原生 button、input、select、dialog 语义或等价 ARIA pattern。
- 页签支持方向键、Home、End。
- 菜单和 Popover 支持 Escape 关闭、点击外部关闭和焦点返回。
- 拖拽必须有键盘替代操作。
- 状态不只使用颜色表达。
- 浅色和深色主题满足 WCAG 2.2 AA 基本对比度。
- 尊重 `prefers-reduced-motion`。

## 10. 实施里程碑

### M1：UI Foundation

- 建立 tokens 和 primitives。
- 拆分工作区滚动容器。
- 统一 Button、Tabs、Disclosure、Dialog、Toast、Status。
- 补齐浅色/深色和键盘测试。
- 不改变数据库和 API。

### M2：Debug Workspace

- 完成 Split Pane 预设与偏好保存。
- 完成 Tool Catalog 筛选、收藏、最近使用和有界渲染。
- 完成 Schema Form 与 Raw canonical 同步。
- 完成结果查看器、诊断复制和 Run 对比。

### M3：Test Experience

- 兼容并复用 1.5.0 测试数据模型与执行 API。
- 将用例、场景、套件和报告迁移到统一 UI Foundation。
- 完成 Run/保存项转换、基线更新和历史比较的体验升级。

### M4：Environment Profiles

- 建立环境配置集和继承规则。
- 增加引用解析预览、缺失检查和安全导出。

### M5：2.0 Release Gate

- 数据迁移、导入导出、完整 E2E 和 npm package smoke。
- 更新 README、升级说明、Changelog 和发布 tag。
- 通过安全、性能、可访问性和视觉回归检查。

## 11. 验收标准

2.0.0 只有同时满足以下条件才可发布：

- 1.x 数据库可原地升级，已有 Server、Tool、Tab、Run、脚本和变量不丢失。
- OAuth、Bearer Token、自定义 Header 和无认证连接均通过真实 fixture。
- 同 URL 的不同 Server 不串认证和 runtime。
- Form/Raw、历史恢复、脚本修改参数和执行之间保持一致。
- 所有结果都能查看请求、响应、调用详情、HTTP、RPC 和时间线。
- 浅色和深色主题通过关键页面截图对比。
- 键盘完成核心流程：选择 Server、选择 Tool、编辑参数、执行、查看结果。
- `npm run verify` 通过且无 open handle。
- `npm pack --dry-run` 只包含允许发布的文件。
- 无 high 级生产依赖安全问题。

## 12. 发布与回滚

- 2.0 使用 SemVer major 发布。
- 发布前备份 SQLite 数据文件或验证自动备份能力。
- migration 执行后不尝试让 1.x 直接打开 2.0 数据库。
- 必须提供导出数据回退路径，而不是执行破坏性降级 migration。
- 每个里程碑保持独立提交和可运行状态。
- 发现数据、安全或认证隔离问题时停止发布，不以 UI workaround 规避。

## 13. 2.0 变更审批边界

以下变更必须先取得产品确认：

- 删除或重命名用户可见能力。
- 改变认证、secret 存储或脱敏默认值。
- 修改现有导出数据的含义。
- 让脚本获得额外网络、文件或宿主权限。
- 改变 Server、Tool Tab 或 Run 的身份边界。
- 引入云服务、账号、远程同步或外部遥测。
- 替换 UI 框架、MCP SDK、数据库或脚本引擎。

## 14. 2.x 后续路线

| 版本方向 | 能力 |
|---|---|
| 2.1 | 测试套件、批量运行、断言报告 |
| 2.2 | CLI/CI、JUnit/JSON 输出、基线管理 |
| 2.3 | OAuth 调试器和认证诊断 |
| 2.4 | 脚本单步调试、Watch、调用栈 |
| 2.5 | Resources、Prompts 等 MCP 模块 |

路线只表达优先顺序，不承诺在缺少独立设计和验收标准时直接实现。
