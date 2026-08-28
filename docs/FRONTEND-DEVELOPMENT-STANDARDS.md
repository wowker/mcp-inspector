# MCP Inspector 前端 UI 与交互开发规范

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Active |
| 版本 | 1.0 |
| 生效日期 | 2026-08-28 |
| 适用对象 | 人工开发者、代码审查者和自动化开发 Agent |
| 适用范围 | `src/client/**` 以及所有用户可见的服务端 HTML |
| 版本规划 | [MCP Inspector 2.0.0 升级规划](./UPGRADE-2.0.0.md) |

## 1. 规范用语

- **必须 / MUST**：不满足时不得合并。
- **应该 / SHOULD**：默认遵循；偏离时必须在 PR 中说明理由。
- **可以 / MAY**：根据场景选择。

本规范优先于单个页面的临时实现习惯。已有代码与本规范冲突时，新代码必须遵循本规范；旧代码在被修改时渐进迁移，不要求一次性重写。

## 2. 产品设计原则

### 2.1 产品类型

MCP Inspector 是高密度、低干扰、可追溯的桌面调试工作台。设计参考开发者工具和 IDE，不采用营销页或卡片型 SaaS Dashboard 的表达方式。

### 2.2 核心原则

1. **上下文优先**：用户必须始终知道当前项目、Server、Tool Tab 和 Run。
2. **结果可追溯**：调用结果必须能回到参数、Tool 快照、认证上下文、脚本和协议事件。
3. **密度来自结构**：通过列表、分区、Disclosure 和 Split Pane 组织信息，不堆叠卡片。
4. **状态不可伪造**：UI loading、connected、running、succeeded、failed 必须来自权威状态。
5. **默认安全**：secret 默认脱敏，导出默认排除敏感值。
6. **键盘等价**：所有鼠标核心操作必须有键盘路径。
7. **渐进增强**：新增 UI 不得破坏现有 API、持久化数据和无 JavaScript 之外的安全边界。

## 3. 技术与依赖

### 3.1 标准技术栈

- React + TypeScript
- 原生 HTML 语义和 ARIA
- 项目 CSS tokens
- Phosphor Icons
- Primer semantic tokens/primitives
- Sonner Toast
- `react-json-view-lite`，仅用于受控 JSON 展示
- Vitest、Testing Library、Playwright

### 3.2 新依赖准入

新增前端依赖必须同时满足：

- 解决现有 primitives 无法合理覆盖的问题。
- 支持 React 19 和 TypeScript。
- 支持键盘和无障碍。
- 支持浅色、深色和自定义 token。
- 不要求引入第二套全局 reset 或图标库。
- 记录 minified/gzip 包体变化。
- 大型编辑器、diff、viewer 必须动态加载。
- 有自动化测试，不以手工截图作为唯一证明。

禁止仅为了单个按钮、Popover、Checkbox 或 Spinner 引入组件库。

## 4. 设计 Token

### 4.1 颜色

组件必须使用语义 token，不得在 feature CSS 中直接新增十六进制颜色。

| Token | 用途 |
|---|---|
| `--ui-canvas` | 应用和页面背景 |
| `--ui-surface` | 面板、输入框、弹层主体 |
| `--ui-surface-muted` | hover、次级区域、表头 |
| `--ui-surface-emphasis` | 高对比标记 |
| `--ui-border` | 主要分割线和边框 |
| `--ui-border-muted` | 列表内部弱分割线 |
| `--ui-text` | 主文字 |
| `--ui-text-muted` | 描述、次要信息 |
| `--ui-text-subtle` | placeholder、空值、禁用信息 |
| `--ui-accent` | 当前项、焦点、主要选择 |
| `--ui-success` | 成功、已连接 |
| `--ui-warning` | 警告、定义变化 |
| `--ui-danger` | 失败、删除、破坏性行为 |

规则：

- 状态必须同时有文字或图标，不得只靠颜色。
- 深色主题必须覆盖全部语义 token，不为单个页面写独立黑色主题。
- 需要新颜色语义时先增加 token，再使用 token。
- 品牌强调色只用于当前项、主要执行和聚焦，不大面积铺底。

### 4.2 字体

- UI：系统无衬线字体栈。
- Tool 名称、参数路径、Run ID、哈希、JSON、HTTP、RPC、日志：`var(--ui-mono)`。
- 正文默认 14px / 1.5。
- 紧凑辅助信息 11–12px，但不得低于 11px。
- 页面标题建议 24–28px；工作区内标题建议 14–18px。
- 不使用全大写长标题。短 eyebrow 或协议标识可以使用大写。

### 4.3 间距

使用以下离散间距：

```text
4, 6, 8, 12, 16, 20, 24, 32, 40
```

- 控件内部间距优先 6、8、12。
- 同组元素间距优先 4、6、8。
- 分区间距优先 12、16、20。
- 页面级间距优先 24、32、40。
- 不因单个截图新增 3px、11px、17px 等一次性值，边框和图标光学校正除外。

### 4.4 圆角与阴影

| 类型 | 标准 |
|---|---|
| 控件 | `--ui-control-radius`，6px |
| 面板 | `--ui-panel-radius`，8px |
| 弹层 | `--ui-overlay-radius`，12px |
| 状态标签 | 999px |

- 数据区域、列表和大面积内容不使用圆角卡片嵌套。
- 普通面板不使用阴影。
- 阴影只用于 Dialog、Popover、Menu 等浮层。
- 禁止渐变背景和发光效果。

### 4.5 动效

- 常规时长 120–180ms。
- 只动画 `transform`、`opacity`、颜色和边框色。
- 禁止对 `width`、`height`、`top`、`left` 做持续布局动画。
- 按钮 active 可以有最多 1px 位移，不得引发旁边图标跳动。
- `prefers-reduced-motion: reduce` 下必须移除非必要动效。

## 5. 布局与滚动

### 5.1 工作台高度

- 应用 Shell 必须使用 `height: 100dvh`。
- 工作台根节点必须 `overflow: hidden`。
- 页面内容必须通过 `minmax(0, 1fr)` 和 `min-height: 0` 传递可收缩高度。
- 禁止用固定像素高度拼接视口。

### 5.2 滚动所有权

每个方向只能有一个主要滚动容器：

| 区域 | 滚动所有者 |
|---|---|
| 一级页面 | `workbench-content` 或页面定义的 scroll region |
| Tool Catalog | Tool tree 列表 |
| 参数区域 | request pane |
| 结果区域 | result content，不包含 sticky header |
| Dialog | dialog body |
| JSON 放大查看 | viewer content |

禁止：

- `body` 与工作台内容同时纵向滚动。
- 参数区内容滚动时带走 Tool Tab 和执行工具栏。
- 结果内容滚动时从 sticky header 上方漏出内容。
- 点击 Radio、Checkbox、Tab 或菜单项后无业务理由地改变滚动位置。

### 5.3 Split Pane

- Split Pane 必须提供指针和键盘调整。
- separator 必须有 `role="separator"`、方向、最小值、最大值和当前值。
- 拖拽只更新当前 pane，不能触发页面滚动或文本选择。
- 必须定义最小尺寸，避免任一面板压缩到不可操作。
- 必须提供恢复默认或布局预设。

### 5.4 响应式策略

- 1024px 以上提供完整桌面工作区。
- 760–1023px 可以收窄导航和 Tool Catalog，但不得隐藏核心操作。
- 760px 以下可以将 Tool Catalog 与工作区上下排列。
- 不要求移动端完成高密度调试，但页面不能出现无法关闭的弹层或不可访问操作。

## 6. 组件标准

### 6.1 Button

标准变体：

| 变体 | 用途 | 示例 |
|---|---|---|
| `primary` | 当前页面唯一主要动作 | 执行、保存修改 |
| `secondary` | 普通动作 | 保存请求、复制全部结果 |
| `quiet` | 工具栏低权重动作 | 刷新、复制 |
| `danger` | 破坏性动作 | 删除 Server、删除文件夹 |

规则：

- 按钮文字使用动词，例如“执行”“保存修改”“复制参数”。
- 同一区域最多一个 primary。
- 纯图标按钮必须有 `aria-label` 和 Tooltip。
- 所有非提交按钮必须显式 `type="button"`。
- loading 时保持原宽度，显示 spinner，并禁用重复提交。
- disabled 必须可解释；必要时用 Tooltip 说明原因。
- 删除操作必须经过确认，确认文案写明对象名称和影响。

### 6.2 IconButton

- 标准尺寸 32×32；紧凑列表允许 28×28。
- 图标建议 16–18px。
- 点击目标不得小于 28×28，触屏媒体查询下不得小于 40×40。
- 显示/隐藏 secret 时按钮必须绝对定位在输入框内，切换图标不得改变布局。
- 图标只使用 Phosphor Icons；同一动作全项目使用同一图标。

### 6.3 Tabs

区分四类页签：

1. Server Tabs：表示运行上下文，48px 高，底部强调线。
2. Tool Tabs：表示可关闭的工作文档，支持固定和菜单。
3. View Tabs：调试、定义、脚本、测试用例、历史。
4. Result Tabs：脚本流水线、请求结果、调用详情、HTTP、RPC、时间线。

规则：

- 必须使用 `tablist/tab/tabpanel` 语义。
- 支持 Arrow、Home、End。
- 切换页签不得重置非当前页签的草稿。
- Tool Tab 菜单必须点击外部或 Escape 关闭，并将焦点返回触发按钮。
- 固定状态使用图标，不追加“已固定”文本污染标题。
- 标题溢出使用省略号，完整名称通过 Tooltip 获取。

### 6.4 SegmentedControl、Radio 和 Checkbox

- 少量互斥选项优先使用 SegmentedControl，例如 Form/Raw、枚举模式。
- 选项超过 5 个或文字较长时使用 Select。
- Radio 必须呈现真实选中标记，整块选项可点击。
- Checkbox 用于独立布尔值；持续开关型配置可以使用 Switch。
- 必填字段不能通过 Checkbox “Skip”绕过，只有 Schema 明确允许或条件分支不生效时才显示跳过能力。
- 点击控件不得提交表单或改变外层滚动位置。

### 6.5 Select

- 未选择 placeholder 统一使用“请选择”。
- placeholder 不得作为一个空白选项重复出现。
- optional unset 项显示“请选择”或“清除选择”，不得显示“空白”。
- 自定义 Select 必须实现完整键盘行为、焦点管理和点击外部关闭；否则使用原生 `select`。
- 下拉层使用 `--ui-surface`，深色主题不得出现白色选项或不可见文字。

### 6.6 FormField

标准顺序：

```text
字段名称 + 必填星号 + 辅助操作
描述
Schema 约束（按需）
输入控件
错误信息（仅出错后）
```

规则：

- 必填使用红色 `*`，不在名称后重复“（必填）”。
- 必填空值 placeholder 使用“请输入必填参数”。
- 错误必须靠近输入控件并通过 `aria-describedby` 关联。
- 普通字段两列排列；复杂 object/array 字段独占一行并撑满内容宽度。
- 普通输入宽度不为了填满屏幕无限拉长，建议内容宽度 480–720px。
- 数值输入不得把合法的 `0` 当作空值。
- secret 字段默认 `type="password"`，可显式切换可见性。

### 6.7 Disclosure

- 标题行高度至少 32px。
- 左侧使用 18px caret，展开时旋转 90°。
- 整个标题行可点击，不只允许点击一个小点。
- 使用 `aria-expanded` 和 `aria-controls`。
- 相同层级的参数、请求参数、请求结果和原始请求响应使用同一 Disclosure 样式。
- 收起内容后，后续区域必须自然顶上，不保留空白高度。

### 6.8 StatusBadge

标准状态：

- `idle`：未执行、未连接
- `pending`：queued、connecting、running、authorizing
- `success`：connected、authorized、succeeded
- `warning`：changed、truncated、partial
- `danger`：failed、removed、cancelled

Badge 使用短文案。详细错误进入结果区或诊断详情，不把错误堆进状态标签。

### 6.9 Table 和 List

- 结构化同类字段使用 Table；导航对象使用 List。
- 表头在独立滚动容器中可以 sticky。
- hover 只使用 `--ui-surface-muted`，不得反转成黑色或白色大块背景。
- 当前行使用左侧 accent 或弱背景，不能同时使用高亮边框、阴影和强色背景。
- 操作列靠右，删除使用 danger 色。
- 大于 200 行的高频列表应该分页或虚拟化。

### 6.10 Dialog

- 优先使用 `<dialog>` 或符合 WAI-ARIA Dialog pattern 的实现。
- 打开后焦点进入第一个合理控件，关闭后返回触发控件。
- Escape 关闭非破坏性 Dialog。
- 点击 backdrop 是否关闭必须与数据丢失风险一致。
- Header、Body、Footer 使用同一 theme surface，禁止深色主体配白色 Footer。
- Footer 固定操作顺序：次要动作在左/前，主要动作在右/后。
- JSON 放大查看建议宽度 `min(1200px, 100%)`，高度不超过视口减 48px。

### 6.11 Popover、Menu、Tooltip

- Menu 用于动作，Popover 用于解释或复杂内容，Tooltip 只用于简短提示。
- 点击外部和 Escape 必须关闭。
- 关闭后焦点返回触发控件。
- 必须做 viewport 碰撞处理，不得被参数区或 Split Pane 遮住。
- 复制成功使用 Toast，不在按钮右侧永久追加“已复制”。

### 6.12 Toast 与错误

- 成功 Toast 默认 2 秒。
- 失败 Toast 提供摘要；可操作详情留在当前页面。
- 同一事件只显示一次反馈，不同时使用顶部文本、Toast 和结果区重复报错。
- 用户文案使用中文，协议名、稳定 error code 和原始字段名可以保留英文。
- 不直接显示 `Failed to fetch`、`Workflow execution failed` 等无上下文底层文本。

### 6.13 Empty、Loading 和 Error State

每个异步区域必须定义：

- initial
- loading
- empty
- ready
- error
- stale（适用时）

结果区未执行时仍展示标准结果结构和空字段，不使用占据大面积的欢迎卡片。

Loading 超过 300ms 才显示可见 loading，避免闪烁。长任务必须显示当前阶段或可取消入口。

## 7. MCP 专用展示规范

### 7.1 Tool Catalog

- 当前列表只显示 Active Server 的 Tool，不重复展示 Server 分组标题。
- Tool 名称使用 mono，描述不在默认列表展示。
- 搜索先按名称精确、前缀、包含排序，再按描述模糊匹配。
- changed、removed 使用短状态标签。
- 文件夹排序在未分类 Tool 之前，支持展开、重命名、删除和键盘移动。
- 删除文件夹默认把 Tool 移到未分类，不删除 Tool 快照。

### 7.2 Tool 定义

- Description 中的 Markdown 只解析受控文本格式，不允许任意 HTML。
- What it does、When to use 等段落来自 Tool description 文本，不假定 MCP 协议定义了这些章节。
- Input/Output Schema 同时提供树形视图和 Raw JSON。
- Tool 快照哈希和历史快照必须提供帮助说明。
- 复制完整定义成功后使用 Toast。

### 7.3 参数编辑

- Form 与 Raw JSON 必须双向同步并保持合法 JSON object 约束。
- 无参数 Tool 的 Raw JSON 可以展示但不可切换编辑；默认参数为空文本，执行时规范化为 `{}`。
- 前置脚本启用时，初始必填校验延后到脚本执行后。
- 脚本修改的参数必须在最终请求和 Run 中记录。
- 历史恢复必须恢复请求和响应，但不得伪装成新的成功执行。

### 7.4 结果区域

- 状态栏和 Result Tabs 固定，不随内容滚动。
- “请求参数”“请求结果”默认展开，均可收起。
- “原始请求与响应”默认收起。
- JSON 默认格式化，结构化内容默认展开到合理深度。
- Copy 操作必须说明复制对象：复制参数、复制响应、复制全部结果。
- 主 Tool 错误只在请求结果展示；脚本错误只在脚本流水线展示。
- 脚本没有失败时，脚本页不得显示 `WORKFLOW_FAILED`。

### 7.5 HTTP、RPC 和时间线

- HTTP 在 RPC 前展示。
- HTTP 请求和响应分区必须撑满可用高度。
- RPC 使用发送/接收主标签，`rpc-out/rpc-in` 作为技术辅助标签。
- Timeline 按 sequence 排序，显示时间、阶段、方向、摘要和可展开详情。
- Timeline 不提供含义不明确的“复制”按钮。

### 7.6 脚本流水线

- 未启用 before/after 时不显示脚本流水线 Result Tab。
- 日志一条记录一行，结构化 data 使用 JSON Viewer。
- 每条日志支持复制和放大查看。
- 试运行和完整流水线必须明确区分。
- 主 Tool 失败不等价于脚本失败。
- 脚本 SDK、样例脚本和限制使用一致 Disclosure 样式。

### 7.7 连接与认证

- runtime、OAuth、Bearer Token、自定义 Header 必须按 connection ID 隔离，不能按 URL 合并。
- 同 URL 的不同 Server 可以使用不同认证并同时存在。
- Header 和 Token 可以保存具体值或 `{{VARIABLE_NAME}}` 引用。
- 变量引用只保存引用字符串；实际值在连接或调用时按 project/server 环境解析。
- 可见性眼睛按钮不得改变输入框宽度或位置。
- OAuth 回调成功后返回 Server 页面，状态显示“已授权，待连接”。连接完成后进入对应 Tools 页面。

## 8. 交互状态与并发

### 8.1 身份 Fence

异步结果写入 UI 前必须校验所属身份：

- project ID
- connection ID
- tab ID
- run ID
- request generation 或 sequence（需要时）

项目、Server 或 Tab 切换后，旧请求不得污染新页面。

### 8.2 重复提交

- 执行、保存、连接、删除必须阻止意外双击重复请求。
- 幂等操作可以 coalesce；非幂等操作必须以 request ID 或服务端幂等键保护。
- loading 状态必须由真实请求生命周期清除，不能由正在查看的历史记录清除。

### 8.3 取消

- 可取消请求使用 `AbortSignal`。
- unmount、project 切换、Server 切换、Run identity 替换时取消不再需要的请求和 timer。
- 取消后的 late completion 不得写入状态。

## 9. 文案规范

- 页面名称可以使用稳定产品词：Servers、Tools、HTTP、RPC、OAuth。
- 操作和说明优先中文。
- 同一对象使用同一名称：Server、Tool、Tab、Run、测试用例、环境变量。
- 不混用“链接”和“连接”；网络会话统一使用“连接”。
- 不使用“当前”作为无意义标签。仅在需要与历史或其他对象区分时使用。
- 错误文案回答三件事：发生了什么、可能原因、下一步操作。
- 避免“未知错误”“操作失败”作为唯一信息。

## 10. 可访问性

### 10.1 必须项

- 所有表单都有可访问 label。
- 所有图标按钮都有 `aria-label`。
- 当前页面使用 `aria-current="page"`。
- Tabs、Dialog、Menu、Disclosure 使用正确语义。
- 动态成功/错误使用合适的 `aria-live`，但不得重复播报。
- 拖拽提供 select/menu 等键盘替代。
- focus-visible 清晰且不能被 overflow 裁剪。
- 不使用正 tabindex。

### 10.2 键盘基线

| 功能 | 键盘行为 |
|---|---|
| Tabs | Arrow、Home、End、Enter/Space |
| Menu | Arrow、Enter、Escape、Tab 关闭 |
| Dialog | 焦点限制、Escape、关闭后返回 |
| Disclosure | Enter/Space |
| Split Pane | Arrow 调整 |
| Tool 选择 | Enter 打开，双击或显式操作新建 Tab |

## 11. React 与 TypeScript 规范

- 禁止 `any`，使用 `unknown` 加运行时解码。
- API client 对成功和失败响应都做边界处理。
- 共享 wire schema 放在 `src/shared`，Server 和 Client 复用。
- 组件 props 表达领域意图，不传递大而无边界的 state bag。
- 复杂业务状态放 feature hook/service，不塞进纯展示组件。
- render 期间不得修改 ref 或外部状态。
- Effect 必须声明清理逻辑，timer、listener、subscription 和 AbortController 不得泄漏。
- 列表 key 使用稳定 ID，不使用 index 表示持久化对象。
- 派生状态优先计算，不重复存储。
- 用户操作依赖保存草稿时必须先 flush，失败则阻止后续跳转并保留原 UI。

建议阈值：

- 单个 UI 组件超过约 300 行时应该评估拆分。
- 单个 feature 文件同时处理 API、领域状态和大量 JSX 时必须拆出 hook 或子组件。
- 阈值不是机械门槛；拆分必须形成清晰边界，不能只移动代码。

## 12. CSS 规范

- 全局 token 和 reset 之外，feature CSS 不得使用裸元素选择器影响其他模块。
- 类名使用稳定 feature 前缀，避免 `.header`、`.content` 等泛化名称。
- 不使用随机生成 class 名解决优先级问题。
- 禁止新增 `!important`，确需使用时必须解释第三方覆盖原因。
- 不通过增加 selector specificity 修复架构问题。
- `:focus-visible`、`:hover`、`:active`、`:disabled` 必须成组考虑。
- dark theme 使用 token，不复制整套组件 CSS。
- 布局容器必须显式考虑 `min-width: 0`、`min-height: 0` 和 overflow owner。
- sticky 元素必须有不透明背景和足够 z-index，内容不得从上方漏出。

## 13. 安全与隐私

- 所有 Tool description、JSON、Header、日志和错误作为文本渲染。
- 禁止 `dangerouslySetInnerHTML`，除非经过独立安全审查和严格 sanitizer。
- secret 不写入 URL、localStorage、sessionStorage、Toast 和普通 console。
- session token 只使用现有 bootstrap/session 机制。
- 复制 secret 必须是明确用户动作。
- 关闭脱敏必须是 Server 级显式配置，并在 UI 提示风险。
- 导出功能必须区分变量引用和变量值。

## 14. 测试规范

### 14.1 组件测试

每个交互组件至少覆盖：

- 默认、hover 可由样式/视觉覆盖，focus 和 keyboard 必须行为测试。
- disabled/loading/error。
- 点击外部与 Escape（浮层）。
- unmount cleanup（timer、listener、request）。
- 浅色/深色中依赖 token，不测试具体色值除非是 token 本身。

### 14.2 Feature 测试

- 项目、Server、Tab、Run 身份隔离。
- stale async response 不写入新上下文。
- 保存失败保留草稿和当前页面。
- 重复点击不会重复执行非幂等操作。
- Form/Raw canonical 同步。
- secret 和 redaction 行为。
- 空、加载、成功、失败、取消和超大数据。

### 14.3 E2E

关键用户旅程必须使用生产 build：

1. 启动并建立会话。
2. 创建/导入 Server。
3. OAuth、Bearer 或 Header 连接。
4. 获取 Tool Catalog。
5. 打开多个 Tool Tab。
6. Form/Raw 编辑和执行。
7. 查看结果与协议轨迹。
8. 保存、历史恢复和重新执行。
9. 刷新后恢复工作区。

E2E fixture 必须使用明确 barrier，不用长时间 sleep 证明并发顺序。

### 14.4 合并门槛

前端变更至少通过：

```bash
npm run typecheck
npm run test
npm run build
```

影响核心旅程、路由、持久化、认证、滚动布局或生产入口时必须运行：

```bash
npm run verify
```

## 15. 新功能交付格式

任何非简单修复的新功能必须包含：

1. 目标和非目标。
2. 用户流程。
3. 状态模型和身份边界。
4. API 与数据模型。
5. UI 状态：initial/loading/empty/ready/error/stale。
6. 键盘和可访问性。
7. secret、导出和日志影响。
8. 兼容与迁移方案。
9. 自动化测试。
10. 发布与回滚条件。

## 16. Review Checklist

### UI

- [ ] 使用现有 token、icon 和 primitive
- [ ] 没有新增一次性颜色、阴影、圆角或间距
- [ ] 浅色和深色均可读
- [ ] loading、empty、error、disabled 已定义
- [ ] 页面没有双重滚动或 sticky 泄漏
- [ ] 操作反馈不重复

### Interaction

- [ ] 所有 button 显式声明 type
- [ ] 键盘可以完成操作
- [ ] Menu/Dialog/Popover 正确关闭并恢复焦点
- [ ] 点击控件不发生意外滚动
- [ ] 重复提交和 stale response 已处理

### Data and security

- [ ] project/connection/tab/run identity 已校验
- [ ] API 响应经过运行时解码
- [ ] secret 默认不展示、不记录、不导出
- [ ] migration 和导入失败保持原子性

### Verification

- [ ] 新行为有先失败后通过的回归测试
- [ ] typecheck、focused tests、full tests 通过
- [ ] 核心旅程变更通过生产 build E2E
- [ ] 没有 open handle 和未清理 timer/listener

## 17. 例外流程

如果需求必须偏离本规范：

1. 在实现前写明冲突条款。
2. 说明用户价值和无法使用标准方案的原因。
3. 说明可访问性、安全、性能和维护影响。
4. 获得明确确认。
5. 对高成本、难逆转决策新增 ADR。

不得先合并例外实现，再通过补文档追认。
