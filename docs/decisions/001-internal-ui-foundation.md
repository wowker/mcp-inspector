# ADR-001：采用项目内部 UI Foundation 渐进升级 2.0

## 状态

Accepted

## 日期

2026-08-28

## 背景

MCP Inspector 已经形成高密度调试工作区，包含多级导航、Tool Catalog、Schema Form、脚本流水线、Run 结果、认证配置和浅色/深色主题。当前主要样式集中在较大的全局 CSS 文件，部分 feature component 同时承担 API、状态和大量 JSX。

2.0 需要统一组件和交互，但直接替换 UI 框架会同时影响已稳定的键盘行为、ARIA、滚动模型、主题、自动化测试和业务状态隔离。

## 决策

采用项目内部 UI Foundation，并渐进迁移现有页面：

- 继续使用 React、项目语义 token、Primer tokens/primitives 和 Phosphor Icons。
- 抽取 Button、Tabs、Disclosure、Dialog、FormField、SplitPane、Status、Toast、JSON Viewer 等稳定 primitives。
- feature 只组合领域状态和 primitives，不创建另一套局部设计语言。
- 每次改动迁移触及的旧 CSS，完成后删除对应旧选择器。
- 不进行一次性全量重写，不为了视觉调整改变 API、SQLite 或调用生命周期。
- 所有新 UI 遵循 `docs/FRONTEND-DEVELOPMENT-STANDARDS.md`。

## 考虑过的方案

### 全量迁移到第三方组件库

优点：组件齐全，短期页面搭建速度快。

缺点：会引入第二套 token、reset、交互和主题语义；高密度 Split Pane、协议结果和复杂 Schema 仍需要大量定制；回归面过大。

结论：拒绝。

### 保持现有页面级 CSS，不抽 primitives

优点：短期修改最少。

缺点：相同操作持续产生不同样式和状态实现；深色主题、焦点、Popover、滚动问题会重复出现；难以建立稳定贡献规范。

结论：拒绝。

### 一次性重写全部前端

优点：可以快速得到整洁目录。

缺点：无法可靠证明行为与现有 1.x 一致；认证、并发 Run、历史恢复和脚本工作流的回归风险不可接受。

结论：拒绝。

## 后果

- 2.0 初期会同时存在旧 CSS 和新 primitives，需要明确迁移边界。
- 新 feature 开发速度在基础组件完成前可能略慢。
- 主题、可访问性、交互态和测试可以在 primitive 层统一验证。
- 业务组件将逐步缩小，视觉问题不再依赖提高全局 CSS specificity 修复。
- 若未来要更换 UI 技术栈，稳定 primitive contract 会形成明确迁移边界。

## 初始执行记录（2026-08-31）

第一批 Foundation 已落地为内部 `Button`、`IconButton`、`StatusBadge` 和 `Disclosure`，并只在 Tool Definition 进行了低风险 PoC 迁移。组件只使用既有 React、Phosphor Icons 和 `--ui-*` semantic tokens；未加入任何第三方组件依赖。聚焦交互、可访问性、中文/英文标签与主题 token 测试均已通过。构建 gzip 从 CSS `71.15 kB` / JS `268.58 kB` 变为 CSS `71.58 kB` / JS `269.11 kB`，增量已记录并可由该基础组件与迁移代码解释。

## Overlay 与表单 primitives 执行记录（2026-08-31）

- `Dialog` 负责所有通用 modal 的焦点进入、循环、返回与可控关闭；Feature 不再复制这部分监听器。
- `Popover` 负责 anchor 位置、视口碰撞、resize/scroll 重定位和 dismissal；具体的 listbox/menu 键盘模型仍由 Feature 的领域组件拥有。
- `FormField` 和 `Select` 以原生 label/select 语义为默认，优先保持 browser keyboard 与辅助技术行为。
- 复用已有 `schema-*` 的 Radio、Checkbox 与 Switch token CSS；不因这次迁移引入第二套选择控件视觉系统。
