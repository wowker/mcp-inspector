# Tool 调试参数录入区第二阶段实施方案

## 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | 已完成；`array<object>`、有界嵌套 object 与可判定组合分支均已交付 |
| 适用版本 | 当前 1.x，兼容 2.0.0 UI Foundation |
| 更新日期 | 2026-08-31 |
| 适用范围 | Tool 调试页的复杂 Schema 参数录入 |
| 前置方案 | [第一阶段优化方案](./PARAMETER-EDITOR-PHASE-1.md) |
| 配套规范 | [前端 UI 与交互开发规范](./FRONTEND-DEVELOPMENT-STANDARDS.md) |

## 1. 目标

在不改变 canonical arguments、`Skip`、脚本延迟校验和 Run 持久化语义的前提下，把高频复杂参数从“只能手写整段 JSON”升级为可结构化编辑的局部工作区。

第二阶段按风险拆为三个独立增量：

1. `array<object>`：条目增删、折叠、排序和字段级编辑。
2. 嵌套 object：分组折叠、递归字段编辑和局部 Form / Raw JSON。
3. `oneOf` / `anyOf`：仅在 Schema 可确定分支身份时提供显式分支选择。

## 2. 不变约束

- Form、字段局部 Raw JSON、整份 Raw JSON 共用同一份 canonical arguments。
- 局部编辑成功后必须同步 `tab.arguments` 与 `tab.rawText`；非法局部 JSON 只保留编辑草稿，不污染 canonical arguments。
- `Skip` 的业务语义不变；启用可选数组时初始化为 `[]`，可选 object 初始化为 `{}`，不再使用 `null`。
- 必填参数、脚本执行后校验、执行门禁和历史恢复语义不变。
- 不改变服务端 API、SQLite 表、导入导出和 Run 数据。
- 不引入第二套组件库、图标库或主题变量。
- 所有按钮显式使用 `type="button"`，操作不得提交外层表单或改变页面滚动位置。

## 3. 第一批：`array<object>`

### 3.1 识别范围

仅当字段 Schema 同时满足以下条件时启用结构化数组编辑：

```json
{
  "type": "array",
  "items": {
    "type": "object"
  }
}
```

以下情况继续使用原有 JSON 编辑器，避免错误解释 Schema：

- primitive 数组；
- tuple `items`；
- items 未声明为 object；
- 无法安全解析的组合 Schema。

### 3.2 交互

- 每个数组条目是一个紧凑 Disclosure，不使用大卡片。
- 默认展开首条；新建条目自动展开。
- 支持新增、删除、上移、下移和折叠。
- 条目内普通字段保持两列；复杂字段独占整行。
- 字段顶部提供局部 `Form / Raw JSON`。Raw JSON 必须是“对象组成的数组”。
- Raw JSON 非法时显示就地错误，并继续保留最近一次合法 canonical value。
- 空数组显示紧凑空状态与“添加一项”，不生成 `null` 占位。

### 3.3 响应式与可访问性

- 760px 以下条目字段切换为单列。
- Disclosure 使用 `aria-expanded` / `aria-controls`。
- Form / Raw 使用 `tablist` / `tab`。
- 移动和删除图标按钮均有包含条目序号的可访问名称。
- 所有操作可使用键盘完成，焦点样式复用全局 token。

## 4. 后续增量

### 4.1 嵌套 object

- object 字段显示可折叠分组。
- 递归编辑必须设置最大可视深度；超过深度继续使用局部 Raw JSON。
- 每个分组独立保留 Form / Raw 草稿，但只提交合法值。
- JSON Pointer 必须作为字段身份，不能只用显示名称。

### 4.2 `oneOf` / `anyOf`

- 优先识别标准 `discriminator.propertyName`。
- 没有 discriminator 时，仅当每个分支存在唯一 `const` / 单值 `enum` 标签时提供选择。
- 无法无歧义识别时继续使用 JSON 编辑，不猜测分支。
- 切换分支前保留公共字段；移除字段必须明确提示，且不得静默丢失未知属性。

## 5. 状态与数据流

```text
局部 Form ─┐
           ├─ 合法值 ─> edit(fieldName, value)
局部 Raw ─┘               ├─> tab.arguments
                          └─> tab.rawText

非法局部 Raw ─> 本地草稿 + 就地错误（不写 canonical arguments）
```

- 状态必须继续绑定 Tool Tab；不得跨 Tab、Server 或项目复用草稿。
- 数组排序只改变当前数组值，不触发 Tool 刷新或 Run。
- 保存失败时保留当前合法 arguments 和局部交互状态。

## 6. 第一批验收标准

- 可选对象数组启用后值为 `[]`，不是 `null`。
- 数组条目可以新增、折叠、排序和删除。
- 条目 primitive 字段可以结构化编辑并同步整份 Raw JSON。
- 字段局部 Raw JSON 可以反向更新 Form。
- 非对象数组 JSON 不覆盖最近一次合法参数。
- 浅色、深色只使用现有语义 token。
- 既有 primitive、普通 JSON、整份 Raw JSON、`Skip` 和脚本执行路径不回归。

## 7. 测试与发布门槛

第一批至少覆盖：

- Schema 识别与安全回退；
- `null` 初始化回归；
- 结构化字段编辑；
- 新增、折叠、排序、删除；
- 局部 Form / Raw 双向同步；
- 非法 Raw 不污染 canonical arguments；
- 中英文资源和键盘语义。

完成每个增量时运行 focused tests 与 typecheck。第二阶段涉及核心参数状态和工作区布局，交付前必须运行：

```bash
npm run verify
```

## 8. 当前实施记录

- 已加入 `array<object>` 的严格识别函数，其他数组继续安全回退。
- 已实现条目新增、删除、上下移动、折叠以及条目 primitive 字段编辑。
- 已实现字段局部 Form / Raw JSON 双模式及 canonical arguments 同步。
- 已修复可选 array/object 启用时默认写入 `null` 的问题。
- 已实现最多两层的嵌套 object 分组、递归 Form、局部 Raw JSON 与 JSON Pointer 草稿隔离。
- 超过可视深度、未知组合 Schema、Schema 或参数值中的 prototype key 均安全回退到局部 JSON。
- 已加入中英文文案、紧凑布局、深浅主题 token 和 focused 回归测试。
- 已实现标准 discriminator 与唯一 const/单值 enum 的确定性 `oneOf` / `anyOf` 分支选择。
- 分支切换保留公共字段与未知扩展字段；删除旧分支专属字段前必须确认，取消不改变 canonical arguments。
- 歧义、畸形或含危险 prototype key 的组合分支安全回退到局部 JSON，不猜测或隐藏值。
- 最新完整门禁通过：66 个 Vitest 文件、585 项测试及 2 项生产 Playwright 流程全部成功。
