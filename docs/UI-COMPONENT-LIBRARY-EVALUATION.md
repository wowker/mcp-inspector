# MCP Inspector UI 组件库评估与渐进接入方案

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Proposed，完成 PoC 和性能验证后再接受具体依赖 |
| 日期 | 2026-08-28 |
| 适用范围 | MCP Inspector 1.x 渐进维护与 2.0 UI Foundation |
| 上位决策 | [ADR-001：采用项目内部 UI Foundation 渐进升级 2.0](./decisions/001-internal-ui-foundation.md) |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |
| 版本规划 | [MCP Inspector 2.0.0 升级规划](./UPGRADE-2.0.0.md) |

## 1. 结论

MCP Inspector 不应全量迁移到 Ant Design、MUI、Chakra UI、Mantine、PrimeReact 或 shadcn/ui，也不应让业务 feature 直接依赖任意第三方组件库。

推荐继续执行 ADR-001：以项目内部 UI Foundation 作为唯一公共组件接口，在其底层通过 PoC 选择一套实现依赖。

推荐顺序如下：

1. 优先评估 `@primer/react`，用于 Button、FormControl、Dialog、ActionMenu、Tooltip 等标准视觉组件。
2. 如果 Primer React 的全局样式、包体或组件约束无法满足项目要求，改为评估 Base UI，复用其无样式交互行为并继续使用项目 CSS token。
3. React Aria Components 只作为复杂 Select、ComboBox、ListBox、Table 和高要求表单的备选，不与 Base UI 或 Radix 同时建设重叠 primitives。
4. Radix Primitives 是 Base UI 的替代方案，不与 Base UI 同时引入。
5. 前置脚本、后置脚本和 Raw JSON 编辑器单独评估 CodeMirror 6，并通过动态导入隔离首屏包体。

在 PoC 通过前，本文件不是新增依赖的授权，也不改变 ADR-001 已接受的架构决定。

## 2. 目标与非目标

### 2.1 目标

- 统一 Button、Input、Select、Dialog、Menu、Tooltip、FormField、Switch 等基础组件的视觉和交互。
- 删除重复的焦点锁定、弹层定位、点击外部关闭、键盘导航和 ARIA 胶水代码。
- 继续使用项目语义 token、Primer token、Phosphor Icons 和 Sonner Toast。
- 支持 React 19、TypeScript、浅色主题、深色主题和键盘等价操作。
- 通过内部 primitive contract 隔离第三方 API，保留未来替换底层实现的能力。
- 在不改变业务状态和身份边界的前提下渐进迁移。

### 2.2 非目标

- 不一次性重写前端。
- 不改变 Project、Connection、Tab、Run 或 Workflow 的状态所有权。
- 不为了视觉升级调整 API、SQLite、认证、脚本沙箱或执行生命周期。
- 不新增第二套图标库、全局 reset、颜色系统或 CSS 编写范式。
- 不同时引入 Primer React、Base UI、React Aria 和 Radix 的重叠组件。
- 不把普通原生 HTML 全部替换为 JavaScript 组件；语义正确且易于统一样式的原生控件可以保留。

## 3. 当前项目盘点

### 3.1 已有基础

当前前端已经使用：

- React 19、TypeScript、Vite。
- `@primer/css` 和 `@primer/primitives`。
- Phosphor Icons。
- Sonner Toast。
- `react-json-view-lite`。
- 项目自有浅色、深色和语义 UI token。
- Vitest、Testing Library 和 Playwright。

因此，项目缺少的不是新的品牌视觉系统，而是统一、可测试的组件边界和成熟的复杂交互实现。

### 3.2 原生控件与手写交互

截至本次评估，`src/client` 中约有：

| 类型 | 数量 |
|---|---:|
| `<button>` | 100 |
| `<input>` | 22 |
| `<select>` | 4 |
| `<textarea>` | 5 |
| `<details>` | 13 |
| 手写 `role="dialog"` | 6 |
| Tab | 12 |
| Tablist | 8 |

高成本重复实现主要集中在：

- Dialog 的焦点进入、焦点循环、Escape、backdrop 和关闭后焦点恢复。
- Menu、Popover、Tooltip 的 viewport 碰撞、点击外部关闭和焦点返回。
- Schema enum Select 的定位、键盘导航、listbox 语义和 Portal。
- 多种 Button、Input、状态和 loading 样式。
- 脚本及 Raw JSON 仍使用普通 textarea，缺少行号、语法高亮、搜索和错误标记。

### 3.3 CSS 与性能现状

- 应用级 `app.css`、`redesign.css` 和 `run-results.css` 合计约 3,860 行。
- JSX 中约有 285 个不同 class 名。
- Primer core 与浅色、深色 token 源 CSS 合计约 442 KB。
- 最近一次生产构建的客户端 CSS 约 479 KB，gzip 后约 69 KB。
- 最近一次生产构建的客户端 JS gzip 约 241 KB，已经高于 2.0 规划中的 220 KB 首屏目标。

新增组件依赖不能继续扩大首屏超标。PoC 必须记录构建差异，并同时给出拆包、删除旧 CSS 或移除重复依赖的抵消方案。

## 4. 评估原则

候选库必须满足：

1. 支持 React 19 和 TypeScript。
2. 支持键盘导航、焦点管理和 WAI-ARIA 模式。
3. 支持普通 CSS、项目 token、浅色和深色主题。
4. 不要求新增第二套全局 reset 或图标库。
5. 可以渐进接入，不要求一次性控制应用根节点和全部页面。
6. 允许封装为内部 primitives，不让第三方类型扩散到 feature props 和领域状态。
7. Tree shaking、动态加载或模块级导入能力清晰。
8. 有持续维护、官方文档和可执行的自动化测试策略。

## 5. 候选方案

### 5.1 Primer React

**适合度：9 / 10，首选 PoC。**

适合组件：

- Button、IconButton、TextInput、Textarea、FormControl。
- Dialog、ConfirmationDialog。
- ActionMenu、ActionList、Tooltip。
- Label、Spinner、状态和基础布局组件。

优势：

- 与项目已使用的 Primer Primitives 最一致。
- 视觉语言接近 GitHub、IDE 和开发者工具，符合高密度、低干扰定位。
- 支持 React 17+、TypeScript 和 Vite。
- 可快速改善大量原生按钮、输入框和弹层的完成度。

风险：

- 可能引入额外运行时和 CSS，必须测量 tree shaking 与 gzip 增量。
- `ThemeProvider`、`BaseStyles` 或完整 Primer CSS 可能和现有 root 样式重叠。
- 组件默认视觉仍需映射为 MCP Inspector 的语义 token 和紧凑尺寸。
- 项目继续使用 Phosphor Icons，不改用另一套图标。

准入方式：

- 只能由 `src/client/components/**` 的内部组件导入。
- feature 不直接导入 `@primer/react`。
- PoC 不启用新的全局 reset；ThemeProvider 和 BaseStyles 必须分别验证是否必要。

官方资料：

- [Primer React 接入与 peer dependencies](https://primer.style/product/getting-started/react/)
- [Primer 组件目录](https://primer.style/product/components/)
- [Primer ActionMenu](https://primer.style/product/components/action-menu/)

### 5.2 Base UI

**适合度：8.5 / 10，首选 Headless 备选。**

适合组件：

- Dialog、Menu、Popover、Tooltip。
- Select、Combobox、NumberField。
- Checkbox、Switch、Tabs、Toolbar、ScrollArea。

优势：

- 完全无样式，不附带 CSS，不规定 styling engine。
- 支持 React 17+、Vite 和普通 CSS。
- 提供成熟的键盘、焦点、Portal、碰撞和 ARIA 行为。
- 能直接沿用项目 token 和现有视觉。

风险：

- 不会自动改善视觉，仍需建设项目内部样式。
- 与 Primer React、React Aria、Radix 的行为组件高度重叠。
- 若 feature 直接使用其 compound API，会形成难以替换的供应商耦合。

准入方式：

- 当 Primer React PoC 因包体、全局样式或定制限制失败时，再进入 Base UI PoC。
- 不与 Radix 同时引入。
- 不同时用 Base UI 和 Primer React 实现同一种 primitive。

官方资料：

- [Base UI 介绍与兼容性](https://base-ui.com/react/overview/about)
- [Base UI 无障碍](https://base-ui.com/react/overview/accessibility)
- [Base UI 发布记录](https://base-ui.com/react/overview/releases)

### 5.3 React Aria Components

**适合度：8 / 10，复杂表单和集合组件备选。**

适合组件：

- Select、ComboBox、ListBox。
- Table、GridList、Tree 等集合组件。
- Tabs、DialogTrigger、Tooltip 和完整 Form 行为。

优势：

- 无样式，提供 class 和 data state 接口。
- 无障碍、国际化和多输入设备覆盖完整。
- Components 与底层 hooks 可以混合使用。

风险：

- API 和 collection model 学习成本较高。
- 迁移简单按钮和输入框的投入产出比不高。
- 与 Base UI、Radix 重叠，不应作为第二套通用基础层并存。

推荐只在参数编辑器出现复杂搜索选择、虚拟集合或普通 Select 无法覆盖的无障碍需求时重新评估。

官方资料：

- [React Aria Getting Started](https://react-spectrum.adobe.com/react-aria/getting-started.html)

### 5.4 Radix Primitives

**适合度：7.5 / 10，Base UI 的替代方案。**

优势：

- 成熟、无样式、可渐进采用。
- Dialog、Dropdown Menu、Popover、Tooltip、Select 等 overlay primitives 完整。
- 通过 class 和 `data-state` 接入项目 CSS。

风险：

- 与 Base UI 定位重叠。
- 项目仍需自行完成全部视觉层。
- 采用后不再同时引入 Base UI。

官方资料：

- [Radix Primitives 介绍](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [Radix Styling](https://www.radix-ui.com/primitives/docs/guides/styling)

### 5.5 CodeMirror 6

**适合度：9 / 10，脚本和 Raw JSON 专用候选。**

适合区域：

- 前置脚本。
- 后置脚本。
- Raw JSON 参数。
- 后续脚本日志搜索或只读源码查看。

预期能力：

- JavaScript 和 JSON 语法高亮。
- 行号、括号匹配、搜索替换、折叠和错误标记。
- 键盘和屏幕阅读器支持。
- 使用项目 token 创建浅色和深色主题。

约束：

- 必须动态导入。
- 未加载完成时保留可访问的 textarea 或明确 loading state。
- 编辑内容继续由现有 canonical state 管理，CodeMirror 不成为业务状态源。
- 语法校验继续走现有隔离 worker/API，不把前端高亮结果当作权威校验。

官方资料：

- [CodeMirror 官方网站](https://codemirror.com/)

### 5.6 react-resizable-panels

**适合度：7 / 10，仅在 Split Pane 继续出现行为问题时评估。**

它提供 Panel、Group 和带完整 WAI-ARIA 属性的 Separator，并支持键盘调整。但当前 Split Pane 已经承载布局保存、折叠和工作区状态，替换属于核心布局变化，必须运行 `npm run verify`。

不因为“已有组件”就立即替换当前实现；只有重复出现指针捕获、键盘调整、嵌套 pane 或响应式问题时才启动 PoC。

官方资料：

- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)

## 6. 不推荐方案

### Ant Design、MUI、Chakra UI、Mantine、PrimeReact

这些库可以快速搭建通用后台，但会带来完整视觉主题、额外 reset、组件语义和更明显的 SaaS Dashboard 风格。MCP Inspector 的核心是高密度开发者工具，不适合为了快速美化而引入第二套设计系统。

### shadcn/ui

shadcn/ui 的代码所有权方式有价值，但当前项目不使用 Tailwind。整套采用会引入第二套 CSS 编写范式和大量复制组件。可以参考其组件拆分方式，不作为项目依赖或默认组件来源。

### Monaco Editor

Monaco 更适合完整 IDE、语言服务和 TypeScript IntelliSense。当前脚本区首先需要语法高亮、行号、搜索和错误标记，CodeMirror 6 的复杂度更合适。只有确认需要完整语言服务后再评估 Monaco。

## 7. 目标架构

```text
features/*
  │
  ├── 只依赖内部组件 props 和领域类型
  ▼
src/client/components/*
  ├── actions       Button / IconButton / Toolbar
  ├── forms         Field / Select / Switch / SecretInput
  ├── overlays      Dialog / Menu / Popover / Tooltip
  ├── layout        Tabs / Disclosure / SplitPane
  ├── feedback      Toast / Alert / Progress / Status
  └── editors       ScriptEditor / JsonEditor（动态加载）
  │
  ├── 项目语义 token + Primer primitives + Phosphor Icons
  ├── 经 PoC 接受的一套底层组件实现
  └── Sonner / react-json-view-lite / CodeMirror 等专用依赖
```

业务层禁止直接依赖第三方组件类型。例如，feature 接收 `DialogProps`、`SelectProps` 或第三方 event type 会破坏内部 Foundation 边界。

## 8. 建议迁移顺序

### P0：建立基线

- 记录生产 JS/CSS 的 raw 与 gzip 大小。
- 记录首屏和 Tools 工作区 chunk。
- 为 Dialog、Menu、Select 的键盘和焦点行为补齐测试。
- 记录浅色、深色和 320/768/1024/1440px 的关键页面结果。

### P1：双 PoC，不进入业务大规模迁移

Primer React PoC 选择三个代表性组件：

1. 一个 Connection Dialog。
2. 一个 Tool 文件夹 ActionMenu。
3. 一个 Schema enum Select 或 FormControl。

只有 Primer React PoC 因包体、样式冲突或行为限制失败时，才用相同范围执行 Base UI PoC。两套 PoC 不进入同一个生产实现。

### P2：建立内部 primitives

- 定义项目自己的 Button、IconButton、Dialog、Menu、Tooltip、Field、Select、Switch contract。
- 使用现有语义 token 和 Phosphor Icons。
- 每个 primitive 覆盖 default、disabled、loading、error、keyboard、focus 和 cleanup。
- 建立 overlay portal 和 z-index 规则，避免各 feature 私建 portal 策略。

### P3：渐进迁移高收益区域

按以下顺序迁移：

1. 6 个手写 Dialog。
2. Tool folder menu、Tool Tab menu 和 Tooltip。
3. 4 个原生 Select 与 Schema enum 自定义 Select。
4. Button、IconButton、FormField、Switch。
5. Disclosure 和状态组件。

每次只迁移一个完整行为切片，并删除对应旧 CSS 和事件处理代码。

### P4：编辑器专项

- 动态加载 CodeMirror 6。
- 先迁移前置和后置脚本。
- 再评估 Raw JSON。
- 保留现有服务端语法校验、草稿 flush 和工作流 revision 规则。

### P5：暂缓高风险区域

以下区域不作为首批迁移对象：

- Server Tabs、Tool Tabs、View Tabs 和 Result Tabs。
- 请求/结果 Split Pane。
- Tool Catalog 拖拽与身份绑定。
- Run、Workflow 和历史恢复状态。

它们与身份隔离、持久化和核心工作流高度耦合，只有内部 primitives 稳定后再逐项迁移。

## 9. PoC 验收标准

候选库只有同时满足以下条件才可进入 Accepted 决策：

### 视觉与主题

- 使用现有语义 token，无新增局部品牌色。
- 浅色、深色、系统高对比模式均可读。
- 保持高密度 IDE 风格，不出现大面积圆角卡片、强阴影或营销页视觉。

### 交互与可访问性

- Dialog 打开后正确聚焦，关闭后焦点返回触发控件。
- Menu、Select、Popover 支持 Escape、外部点击、方向键、Home、End 和合理的 Tab 行为。
- 纯图标按钮有可访问名称和 Tooltip。
- 不产生意外页面滚动、双重滚动或 sticky 泄漏。

### 状态与安全

- 不改变 Project、Connection、Tab、Run identity fence。
- 不把 secret 写入 Toast、DOM 属性、URL、浏览器存储或日志。
- loading、disabled、error 和取消状态来自真实业务生命周期。

### 性能

- 记录依赖接入前后的每个 chunk、首屏 JS 和 CSS gzip 差异。
- 不扩大当前首屏 JS 超出 220 KB 预算的问题；无法直接达标时必须提供拆包或删除旧依赖的明确方案。
- CodeMirror、diff、viewer 等大型模块必须动态加载。

### 自动化验证

- focused component tests。
- `npm run typecheck`。
- `npm run test`。
- `npm run build`。
- 影响核心布局、滚动、路由、认证或生产入口时运行 `npm run verify`。

## 10. 决策门槛

PoC 完成后应新增或更新 ADR，记录：

- 接受的底层实现及版本范围。
- 被拒绝候选和实测原因。
- raw、minified、gzip 和 chunk 变化。
- ThemeProvider、Portal、reset 和 z-index 的最终策略。
- 内部 primitive contract 与第三方依赖边界。
- 回滚到原实现的方式。

若 Primer React 和 Base UI 均无法在性能、视觉或兼容性上通过验收，则继续自建内部 primitives，不为了“必须使用组件库”而降低标准。

## 11. 最终推荐

当前最值得执行的路线是：

```text
内部 UI Foundation（唯一业务接口）
├── 首选 PoC：Primer React
├── Headless 备选：Base UI
├── 专用编辑器：CodeMirror 6，动态加载
├── 保留：Primer tokens、Phosphor Icons、Sonner
└── 不采用：全量第三方 UI 框架迁移
```

该路线能最快改善原生控件和手写弹层的展示质量，同时保持 ADR-001、2.0 性能预算、现有身份隔离和渐进迁移要求。
