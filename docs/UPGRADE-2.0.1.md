# MCP Inspector 2.0.1 更新计划

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | Implemented，完整质量门禁已通过 |
| 目标版本 | `2.0.1` |
| 当前基线 | `2.0.0` |
| 更新日期 | 2026-09-03 |
| 适用范围 | Web UI、内部 UI Foundation、自动化测试体验、运行历史 |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |
| 上游规划 | [MCP Inspector 2.0.0 升级规划](./UPGRADE-2.0.0.md) |

> 2.0.1 是 UI 体验和组件收敛版本。它复用 2.0.0 已有 API、SQLite 数据、测试执行、
> 报告和运行历史契约，不新增 migration，不改变 Project、Connection、Tab、Run、测试用例、
> 测试套件或执行记录的身份边界。

## 1. 更新摘要

2.0.1 聚焦两个问题：一是把长选项集合统一为可搜索、可键盘操作的共享选择组件；二是把自动化测试页面中远离操作对象或重复出现的创建/工具按钮迁回对应内容区。同时为运行历史筛选增加可访问的字段说明。

本版本必须交付：

1. 新增内部共享 `SearchableSelect`，复用现有 token、Popover 和 Phosphor Icons。
2. 盘点并迁移 Server、Tool、测试用例、场景映射、环境配置和 Tool 文件夹等长列表选择器。
3. 调整测试用例、测试套件和测试报告的操作入口位置，并消除重复创建入口。
4. 为运行历史筛选增加 `?` 帮助入口和中英文说明。
5. 为每项行为变化增加组件测试、页面回归测试和关键生产 E2E 覆盖。

## 2. 目标与非目标

### 2.1 目标

- 长列表无需滚动遍历即可通过名称或辅助关键词定位选项。
- 搜索选择器具备完整的键盘、焦点、关闭和屏幕阅读器行为。
- 业务页面只传入受控值和选项，不各自维护搜索、活跃项、弹层定位或 listbox 键盘逻辑。
- 创建动作靠近所创建对象的列表，页面标题区只保留标题与说明。
- 报告页操作与报告说明形成一个明确的纵向标题区，三个按钮保持同组。
- 用户可以在不猜测字段含义的情况下配置运行历史筛选。

### 2.2 非目标

- 不把所有短选项的原生 `Select` 强制替换为可搜索组件。
- 不改变测试用例、测试套件、报告或 Run 的 API、持久化结构和执行行为。
- 不新增另一套视觉系统、图标库、全局 reset 或 Feature 私有下拉框。
- 不在本版本引入跨字段高级查询语法、服务端模糊搜索或新的分页协议。
- 不借布局调整改变按钮权限、导入导出语义、基线更新或破坏性确认流程。

## 3. 下拉框现状盘点与迁移边界

当前 `src/client` 存在三条选择器实现路径：

- `components/forms/Select.tsx`：原生 `<select>` 的样式包装，不支持搜索。
- `features/tabs/ParameterControls.tsx`：Schema enum 的手写 listbox。
- `features/tools/ToolFolderSelect.tsx`：Tool 文件夹的另一套手写 listbox。

此外，环境变量和测试套件页面仍有直接使用的原生 `<select>`。2.0.1 不继续复制第四种实现，而是引入一个内部共享组件，并按集合规模和变化频率选择控件。

### 3.1 应迁移为可搜索选择器

| 模块 | 使用位置 | 选项来源 | 2.0.1 决策 |
|---|---|---|---|
| Tool 参数 | Schema enum | Tool Schema，数量不可控 | 迁移；选项较少时仍可由现有规则显示 Radio |
| Tool Catalog | 移动到文件夹 | 当前 Server 的文件夹 | 迁移并删除 Feature 私有 listbox 行为 |
| 环境变量 | 选择 Server | 项目连接列表 | 迁移 |
| 环境配置集 | 父配置、Server、预览配置 | 项目配置与连接列表 | 迁移 |
| 测试用例 | Server、Tool | 项目连接和活动 Tool 列表 | 迁移；Tool 搜索优先级为精确、前缀、包含 |
| 场景测试 | 步骤 Server/Tool、先前步骤、输入、变量 | 当前场景与项目运行上下文 | 迁移；继续限制为当前步骤之前可引用的数据 |
| 测试套件 | 候选测试用例 | 项目测试用例列表 | 在成员区增加共享搜索能力，不改变稳定成员 ID 和排序 |
| 测试报告导入 | Server 绑定 | 当前项目连接列表 | 迁移；仍保存并提交 connection ID |

### 3.2 保留轻量 Select 的场景

以下集合固定、数量少且无需文本查找，继续使用共享 `Select` 或更合适的 Radio/SegmentedControl：

- 语言选择。
- 认证模式。
- 文本/JSON、继承/覆盖、清除值等值模式。
- 原始/回放、仅固定/仅未固定等二到三项策略。
- 场景失败策略、映射来源类型和断言数据源中的短固定集合。
- 测试套件并发数 `1–8`；继续使用轻量 Select，不为八个数字增加搜索框。

运行状态当前为八个固定值。2.0.1 先保留轻量 Select；如果后续状态集合继续扩展，再迁移到可搜索组件。断言 operator 可以在选项超过共享阈值时启用搜索，source 保持轻量 Select。

### 3.3 迁移原则

- 是否可搜索由产品语义与集合规模决定，不由单个页面自行复制实现。
- 推荐默认阈值为可见选项超过 8 个时显示搜索；动态的 Server、Tool、测试用例、步骤和变量集合可以显式始终启用搜索。
- 替换控件不得改变提交值；Connection 必须继续提交 connection ID，Tool 提交稳定名称，测试与套件成员继续提交稳定 ID。
- Project、connection、test case、suite、step 或导入文件变化时，旧的搜索结果和高亮项必须清空或通过身份 fence 拒绝写入。

## 4. 共享 `SearchableSelect` 设计

### 4.1 组件边界

新增组件建议放在 `src/client/components/forms/SearchableSelect.tsx`，组件测试与其同层或进入现有 Foundation 测试目录。Feature 不直接依赖第三方组件 API。

组件使用受控值，建议公开以下稳定概念：

```ts
interface SearchableSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

interface SearchableSelectProps<T extends string> {
  value: T | null;
  options: readonly SearchableSelectOption<T>[];
  onChange: (value: T | null) => void;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
}
```

实际实现可以按 TypeScript 推断需要收敛类型，但不得暴露大而无边界的 Feature state bag。组件只拥有打开状态、查询文本和活跃选项；业务选中值仍由调用方拥有。

### 4.2 搜索与显示

- 默认对 `label` 和 `keywords` 做大小写不敏感、首尾空白归一化的本地搜索。
- 结果按精确匹配、前缀匹配、包含匹配排序；相同等级保持原始稳定顺序。
- 不修改或翻译 Tool 名称、变量名、ID 等原始值；产品文案由 `zh-CN/en-US` 资源提供。
- 搜索为空时显示全部选项；无结果时显示明确 empty state，不把“无结果”伪装成可选项。
- 选中项必须同时使用 Check 图标和 `aria-selected`，不能只依赖颜色。
- 弹层匹配触发器宽度并做 viewport 碰撞处理；长列表拥有自己的单一纵向滚动容器。
- 超过 200 个可见选项时使用有界渲染或经过验证的虚拟化，不能一次渲染无上限集合。

### 4.3 键盘与焦点

- 触发器通过 Enter、Space、ArrowDown 和 ArrowUp 打开；打开后搜索输入获得焦点。
- ArrowUp/ArrowDown 移动活跃项，Home/End 到首尾可用项，Enter 选择，Escape 关闭。
- Tab 关闭弹层并保持正常焦点顺序；点击外部关闭。
- 选择或 Escape 关闭后焦点返回触发器；Project 或上游选择变化导致关闭时不得把焦点跳到无关区域。
- 触发器、搜索输入和 listbox 使用匹配的 `aria-expanded`、`aria-controls`、`aria-activedescendant`、`role="option"` 与可访问名称。
- 组件覆盖 disabled、loading、empty、单选清除和重复 value 校验；纯图标清除按钮必须有国际化 `aria-label` 和 Tooltip。

### 4.4 依赖策略

第一选择是复用现有 `Popover`、token 和图标，在内部 Foundation 中完成组件，不新增运行时依赖。若 PoC 无法同时满足组合输入法、屏幕阅读器和大集合有界渲染，再依据 [UI 组件库评估](./UI-COMPONENT-LIBRARY-EVALUATION.md) 单独评估 React Aria ComboBox；采用前必须记录 minified/gzip 增量，并且仍只能从内部组件导入。

## 5. 页面调整

### 5.1 自动化测试：测试用例

当前“新建测试用例”和“新建场景”位于页面右上角，同时空列表又提供“新建测试用例”，形成重复入口。

2.0.1 布局：

```text
测试用例  创建、编排并执行可复现的 Tool 测试。
┌─ 测试用例列表 ─────────────────┬─ 编辑区 ────────────────┐
│ 搜索测试用例                    │                         │
│ [新建测试用例] [新建场景]       │                         │
│ 用例列表 / 空状态说明           │                         │
└─────────────────────────────────┴─────────────────────────┘
```

要求：

- 从页面标题右侧移除两个创建按钮。
- 在左侧测试用例列表的搜索栏下方新增创建操作行，顺序固定为“新建测试用例”“新建场景”。
- “新建场景”作为该区域唯一 primary；“新建测试用例”使用 secondary，与现有动作权重一致。
- 空状态只保留说明，不再渲染第三个创建按钮；创建行为只保留上述两个入口。
- 两个按钮复用同一组创建回调，防止布局迁移后产生两套状态初始化逻辑。
- 窄侧栏中操作行允许换行或等宽两列，但不能遮挡搜索框、列表或滚动条。

### 5.2 自动化测试：测试套件

当前“新建套件”位于页面右上角，远离套件列表。

要求：

- 从页面标题右侧移除“新建套件”。
- 将按钮放入左侧套件列表内部，位于列表标题/计数之后、套件条目之前。
- 使用 primary 按钮并保留现有草稿初始化、执行清理和 identity fence 行为。
- 空状态不再增加第二个创建入口；列表为空时，按钮仍然始终可见。
- 按钮不进入列表滚动内容，长套件列表滚动时保持入口稳定可见；不得因此制造页面与列表双重滚动。

### 5.3 自动化测试：测试报告

当前“导出、导入、刷新”位于页面标题行右侧。2.0.1 将它们放到“测试报告 / 查看执行历史、断言结果与完整调用追溯。”文本块下方。

要求：

- 标题、说明、操作行纵向排列；操作行紧接说明下方。
- 操作顺序固定为“导出、导入、刷新”，水平方向一个挨一个，使用现有 8px 同组间距。
- 三个按钮继续使用 secondary，不新增页面级 primary。
- 文件 input 继续视觉隐藏并保留可访问名称，不改变导入选择和清空逻辑。
- 中英文按钮宽度增长时操作行可整体换行，不能裁剪文案或把按钮推到不可见区域。

### 5.4 运行历史：筛选帮助

在“筛选”标题右侧增加 Phosphor `Question` 图标按钮。由于说明包含多个字段，不使用只能承载短文本的 Tooltip，而使用可点击的说明 Popover；图标按钮仍提供简短 Tooltip 和国际化 `aria-label`。

帮助内容必须解释：

| 筛选项 | 说明 |
|---|---|
| Tool 名称 | 按完整 Tool 名称精确匹配，不是模糊搜索 |
| Connection ID | 按创建 Run 时使用的连接 UUID 精确匹配；相同 URL 的不同连接不会合并 |
| 状态 | 按 Run 的当前/最终执行状态匹配，如排队、连接、授权、运行、成功、失败、取消或中断 |
| 来源 | “原始”表示普通执行，“回放”表示从历史 Run 显式发起的再次执行 |
| 固定状态 | 仅显示已固定或未固定的 Run；固定只影响保留/查找，不改变执行结果 |
| 开始时间 | 包含该本地时间点及之后创建的 Run，提交时转换为 UTC |
| 结束时间 | 包含该本地时间点及之前创建的 Run，提交时转换为 UTC |
| 应用/重置 | “应用”提交当前草稿筛选；“重置”清空筛选和当前详情选择 |

Popover 必须支持 Escape、点击外部关闭和焦点返回，不改变筛选草稿、已应用筛选、当前 Run 或列表滚动位置。

## 6. 状态、身份与兼容

- 搜索查询是瞬时 UI 状态，不写入 SQLite、URL、导出文件、Run 或测试定义。
- 组件迁移不得改变任何 option 的持久化值或 API payload。
- Connection 相关选择器继续以 connection ID 为值，绝不按 URL 或显示名称恢复选择。
- Tool、场景步骤、测试用例与套件成员保持现有 stable key；不得使用过滤后数组 index 作为业务身份。
- 上游上下文变化时取消不再需要的请求，并以现有 generation/ref fence 拒绝 late completion。
- 2.0.0 已保存的数据和浏览器中的非敏感 locale 偏好无需迁移；2.0.1 可直接回滚到 2.0.0，因为本计划不改变数据库与 API。

## 7. 实施任务

### M1：共享组件基础

- [x] Task 1：冻结 `SearchableSelect` 的受控值、option、搜索、清除、loading 和 empty 契约。
- [x] Task 2：先写组件交互测试，再实现搜索排序、Popover、焦点返回和完整键盘行为。
- [x] Task 3：补齐浅色/深色、长文案、窄宽度、大集合和组合输入法验证；记录构建体积变化。

验收：组件不依赖 Feature state；鼠标、键盘和屏幕阅读器路径等价；无新增全局视觉系统。

### M2：高价值选择器迁移

- [x] Task 4：迁移测试用例与场景中的 Server、Tool、步骤、输入和变量选择器。
- [x] Task 5：迁移环境变量/配置集、报告导入绑定和 Tool 文件夹选择器。
- [x] Task 6：让 Schema enum 复用共享组件，同时保留少量 primitive enum 的 Radio 规则。
- [x] Task 7：为测试套件候选用例增加共享搜索，不改变成员顺序、稳定 ID 或执行输入。

验收：动态长列表都可搜索；短固定集合仍保持轻量；旧 Feature 私有 listbox 的重复行为被删除。

### M3：自动化测试页面布局

- [x] Task 8：把测试用例的两个创建入口移至搜索栏下方，并删除标题区和空状态重复入口。
- [x] Task 9：把新建套件入口移至套件列表内部，并保持列表单一滚动所有权。
- [x] Task 10：把测试报告三个操作按钮移至说明下方，验证中英文和响应式换行。

验收：每个创建动作只有一个可见入口；所有原行为、权限、草稿和执行状态保持不变。

### M4：运行历史帮助与交付

- [x] Task 11：实现筛选帮助 Popover 和 `zh-CN/en-US` 文案，覆盖全部筛选项。
- [x] Task 12：完成页面回归、生产 E2E、视觉回归、包体与完整发布门槛。

验收：帮助入口可通过键盘访问且不改变筛选状态；所有 2.0.0 核心旅程保持通过。

## 8. 测试与验证

### 8.1 组件测试

- 搜索的精确、前缀、包含排序和稳定顺序。
- 空查询、无结果、disabled option、loading、clearable 和重复 value 防御。
- Enter/Space/Arrow/Home/End/Escape/Tab、点击外部、选择后焦点返回。
- 上游 options/value 更新后不保留失效活跃项，不触发幽灵 `onChange`。
- 中英文可访问名称、Check 状态和 listbox/option 语义。

### 8.2 Feature 回归

- 测试用例创建入口去重，两种草稿仍正确初始化且不会串 execution。
- 测试套件创建、选择、成员增删、保存、运行和取消保持原行为。
- 报告导入/导出/刷新、Server 绑定、基线更新和文件 input 清空保持原行为。
- 场景映射仍禁止前向引用；切换 Server 后清理或隔离旧 Tool 结果。
- 环境配置父子关系、connection ID 和预览选择保持身份隔离。
- 运行历史帮助开关不提交、重置或修改筛选，说明与实际精确匹配语义一致。

### 8.3 交付命令

开发中先运行对应 Foundation、testing、environment、tools 和 runs 的 focused tests。合并前必须运行：

```bash
npm run typecheck
npm run test
npm run build
npm run verify
git diff --check
```

同时验证：

- `zh-CN` 与 `en-US` key 集合严格一致。
- 320、760、1024 和 1440px 下按钮、Popover 和列表无不可达操作。
- 浅色/深色下 trigger、搜索输入、选中态、空状态和 focus-visible 均清晰。
- 生产 E2E 至少覆盖一次搜索选择 Server/Tool、两个创建入口、报告操作行和筛选帮助。
- 首屏 bundle 不因组件迁移出现无法解释的增长；若新增依赖，必须单列 minified/gzip 差异。

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自制 ComboBox 键盘或读屏行为不完整 | 高 | 先写交互契约和自动化测试；PoC 不达标时按既有评估转入 React Aria |
| 全量替换短 Select 增加操作成本 | 中 | 只迁移动态/长集合，固定短集合继续使用轻量 Select/Radio |
| 过滤后 index 被误作业务值 | 高 | 组件只返回稳定 `value`；Feature 持续使用 connection/test/step ID |
| 页面按钮移动改变状态初始化 | 中 | 复用原回调，先补行为回归测试，再移动 DOM |
| Popover 造成双重滚动或被裁剪 | 中 | 复用 Portal 和碰撞策略，明确弹层为唯一选项滚动容器 |
| 英文文案导致操作行溢出 | 中 | 按规范预留 30–50% 增长并允许整组换行 |
| 新依赖扩大已超预算的首屏 JS | 高 | 默认复用现有 Foundation；只有 PoC 证明必要且记录体积后才准入 |

## 10. 发布与回滚

- 2.0.1 发布前不得存在未通过的键盘、身份隔离、测试执行或报告导入导出回归。
- 发现 connection ID 串用、搜索选择错误对象、草稿被清空或按钮触发重复请求时停止发布。
- 本计划不新增 migration 或 API；回滚只需恢复前端产物，不执行数据降级。
- README、Changelog 和发布说明只描述已经通过验收的行为，不提前宣称 Proposed 项已交付。

## 11. 交付记录

- 共享 `SearchableSelect` 已覆盖本计划列出的动态选择场景；固定短集合继续使用轻量 `Select` 或 Radio。
- 生产构建未增加运行时依赖；当前主要客户端 gzip 产物约为 `159.96 kB` 与 `170.97 kB`，构建仍只报告既有的大 chunk 提示。
- 生产 E2E 已覆盖自动化测试 Server/Tool 搜索、报告导入绑定、按钮布局及 320/760/1024/1440px 操作可达性。
- 2026-09-03 已通过 `npm run verify` 与 `git diff --check`。
