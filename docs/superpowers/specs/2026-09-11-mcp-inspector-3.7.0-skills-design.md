# MCP Inspector 3.7.0 Skills 设计规格

**日期：** 2026-09-11  
**状态：** 已完成讨论，等待整体复核  
**目标版本：** 3.7.0  
**依赖：** 3.5.0 Authoring MCP 验证、证据与复核链路  

## 1. 背景与目标

MCP Inspector 已经可以让外部 AI Agent 发现和调用下游 MCP Tools、创建自动化测试 Draft、编排多 Tool Scenario、执行准确修订并保存正式测试资产。但是，Agent 仍然需要用户在每次对话中重复说明如何选择测试类型、如何建立步骤间数据流、何时轮询、何时清理副作用，以及如何遵守修订冻结和人工复核边界。

3.7.0 增加项目级 Skills 能力，将这些稳定工作流沉淀为 Agent 可发现、可拉取、可版本化的文本型 Skill。Inspector 是 Skill Registry 和内容提供方；Agent 负责读取、使用以及在获得自身运行环境所需权限后安装到项目的 `.agents/skills/`。

成功意味着：

- 每个项目都能使用 Inspector 提供的标准 Skills；
- 用户可以在项目内创建和管理自己的文本型 Skills；
- 标准 Skill 与用户 Skill 使用同一套项目存储、修订、发布和读取模型；
- Agent 能通过 Authoring MCP 发现并拉取准确 Skill revision；
- Inspector 不读取、不写入也不跟踪 Agent 的 `.agents/skills/` 安装状态；
- 首批标准 Skill 能可靠指导 Agent 完成 Inspector 的核心测试与诊断工作流；
- Skill 内容不能突破现有项目、连接、Tool、Run、Draft、验证或复核身份边界。

## 2. 范围

### 2.1 3.7.0 包含

- 独立一级 `Skills` 模块；
- 项目 SQLite 中统一保存标准与用户 Skills；
- 标准 Skill 的项目初始化和版本同步；
- 用户 Skill 的创建、查看、修改、校验、发布、禁用、软删除和恢复；
- 不可变 Skill revisions、发布指针和 canonical content digest；
- Authoring MCP 的 Skill 列表、Manifest 和文件读取能力；
- 仅支持 `SKILL.md` 与 `references/**/*.md` 的文本型 Bundle；
- 项目导入导出中的用户 Skill 和标准 Skill 兼容处理；
- 七个首批标准 Skills；
- 中英文 UI、键盘操作、可访问状态和安全 Markdown 查看；
- 单元、集成、迁移、MCP、浏览器 E2E 与标准 Skill 行为测试。

### 2.2 3.7.0 不包含

- Inspector 安装、更新或卸载 Agent 本地 Skill；
- Inspector 读取 `.agents/skills/` 或展示具体 Agent 的安装状态；
- Agent 通过 Authoring MCP 创建、修改、发布或删除用户 Skill；
- 跨项目全局用户 Skill；
- `scripts/`、可执行文件、二进制 assets、符号链接或外部文件引用；
- 自动执行用户 Skill 中描述的 Tool 操作；
- 新的测试执行器、断言引擎或 Agent runtime；
- 以 Skill 绕过 Authoring Policy、破坏性操作确认、修订冻结或人工复核。

后续版本可以独立评估 Agent 创建 Skill Draft、跨项目 Skill 库、脚本型 Skill、Skill 签名、远程仓库同步和安装状态回报，但不得作为 3.7.0 的隐藏扩展。

## 3. 关键决策

### 3.1 Inspector 只提供，Agent 负责安装

Inspector 的职责是保存、校验、版本化、发现和分发 Skill。Agent 的职责是决定是否使用或安装 Skill，向自身运行环境申请文件权限，并写入项目级 `.agents/skills/`。

Inspector 不提供以下 MCP Tools：

```text
inspector_install_skill
inspector_update_skill
inspector_uninstall_skill
```

Inspector 也不接受 Agent 声称的安装状态作为权威数据。

### 3.2 统一项目存储

标准 Skill 和用户 Skill 一起存入项目 SQLite。二者使用相同的 Skill identity、revision、Bundle、发布与查询模型，通过 `origin` 和服务端权限规则区分。

Inspector 安装包携带标准 Skill seed catalog。项目打开时，服务端将 seed 内容幂等同步到项目数据库；运行时浏览器和 Agent 都从项目数据库中的统一 Registry 读取。

### 3.3 文本型 Skill

3.7.0 仅允许：

```text
SKILL.md
references/**/*.md
```

不允许脚本、二进制 assets、HTML、隐藏文件、符号链接、项目外部引用或其他扩展名。该边界使 3.7.0 保持为持久化工作流说明系统，而不是代码分发系统。

### 3.4 Draft 与发布分离

用户保存 Skill 只产生新的草稿 revision。只有显式校验并发布的 revision 才能被 Agent 发现。编辑新草稿期间，旧发布 revision 继续稳定可读。

### 3.5 精确 revision 拉取

Agent 先读取 Skill summary 和 Manifest，再按准确 `projectId + skillId + revision + expectedDigest + path` 拉取文件。新版本发布不得改变或混入正在读取的旧 revision。

## 4. 能力模块图

| 模块 ID | 职责 | 依赖 |
|---|---|---|
| `skill-domain` | Skill、revision、文件 Bundle、状态、限制和错误契约 | — |
| `skill-persistence` | SQLite 迁移、统一仓储和不可变 revisions | `skill-domain` |
| `standard-skill-sync` | 标准 Skills 的幂等项目同步 | `skill-persistence` |
| `skill-validation` | frontmatter、路径、文本、大小和 digest 校验 | `skill-domain` |
| `skill-management` | 用户 Skill CRUD、发布、禁用与软删除 | `skill-persistence`, `skill-validation` |
| `skill-discovery-mcp` | Agent 列表、Manifest 和准确文件拉取 | `skill-management`, `standard-skill-sync` |
| `standard-skill-library` | 七个 Inspector 标准 Skills | `skill-discovery-mcp` |
| `skills-ui` | 标准 Skill 查看和用户 Skill 管理 | `skill-management` |
| `skill-portability` | 项目导入导出与标准版本重新同步 | `standard-skill-sync`, `skill-management` |

依赖方向保持单向：

```text
skill-domain
    ↓
skill-persistence + skill-validation
    ↓
standard-skill-sync
    ↓
skill-management
    ↓
skill-discovery-mcp
    ↓
standard-skill-library
    ↓
skills-ui
    ↓
skill-portability
```

浏览器和 Authoring MCP 共用同一个 Catalog、Repository 和 Validator，不分别复制业务规则。

## 5. 领域模型

### 5.1 Skill

```ts
interface ProjectSkill {
  id: string;
  projectId: string;
  origin: "STANDARD" | "USER";
  standardKey: string | null;
  slug: string;
  name: string;
  description: string;
  state: "ACTIVE" | "DISABLED" | "DEPRECATED" | "DELETED";
  revision: number;
  publishedRevision: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

规则：

- `id` 是项目内稳定 UUID；
- `standardKey` 仅标准 Skill 使用，例如 `mcp-inspector/authoring-scenario-tests`；
- `slug` 使用小写字母、数字和连字符，最大 63 个字符；
- 标准 Skill 的内容、名称、slug、版本和删除状态只能由标准同步模块改变；
- 用户不能使用已被标准 Skill 占用的 slug；
- 是否存在草稿和是否已经发布分别由 `revision > publishedRevision` 与
  `publishedRevision !== null` 推导，不与生命周期状态混在一起；
- `DISABLED` Skill 不参与 Agent 发现；
- `DELETED` 仅用于用户 Skill 软删除；
- 内置 catalog 不再包含某个标准 Skill 时，将项目记录标记为 `DEPRECATED`，不物理删除。

### 5.2 Skill revision

```ts
interface ProjectSkillRevision {
  id: string;
  projectId: string;
  skillId: string;
  revision: number;
  version: string;
  contentDigest: string;
  files: Record<string, string>;
  createdAt: string;
  publishedAt: string | null;
}
```

- Revision 快照创建后不可修改；
- Skill 更新创建新 revision；
- 标准 Skill 使用独立 SemVer；
- 用户 Skill revision 使用单调递增整数，版本标签由系统固定生成为 `r<revision>`；
- `contentDigest` 覆盖 canonical 排序后的所有文件路径和 UTF-8 内容；
- 发布操作只移动 `publishedRevision`，不重写 revision；
- 所有修改使用 `expectedRevision` 和 idempotency key。

### 5.3 存储

新增项目数据库表：

```text
project_skills
project_skill_revisions
project_skill_validations
project_skill_mutation_keys
```

具体迁移编号在 3.7.0 开始实施时使用主分支的下一个可用编号，不提前占用可能由 3.6.0 使用的编号。不得修改已经发布的 migration。

`project_skill_revisions.files_json` 原子保存完整文本 Bundle。该选择保证一个 revision 内的 `SKILL.md` 与 references 不会出现跨事务版本混合。

`project_skill_validations` 保存绑定 `projectId + skillId + revision + contentDigest`
的不可变校验结果与 issues。发布必须携带仍然有效的 validation digest；校验不会
回写不可变 revision。

## 6. 标准 Skill 同步

Inspector 安装包包含标准 Skill seed catalog。项目打开后的同步过程为：

```text
读取 seed catalog
→ 校验全部 seed Bundle
→ 按 standardKey 查询项目记录
→ 比较 version 与 digest
→ 在单个事务中插入或追加 revisions
→ 更新发布指针
```

规则：

- 项目没有标准 Skill 时，插入 Skill 和首个发布 revision；
- version 与 digest 相同时不写数据库；
- seed 版本较新且内容有效时追加 revision；
- 数据库版本较新时不降级覆盖，记录兼容性警告；
- 同一版本不同 digest 是发布完整性错误，不覆盖项目记录；
- 任一标准 Bundle 同步失败时，本轮标准同步事务回滚；
- 标准同步失败不阻止项目打开，也不影响用户 Skill；
- 重复打开项目必须是幂等的；
- 项目导入后再次执行相同同步。

## 7. 用户 Skill 管理

### 7.1 生命周期

```text
创建 Skill
→ 保存 DRAFT revision
→ 校验
→ 发布准确 revision
→ PUBLISHED
→ 基于发布 revision 创建新草稿
→ 校验并再次发布
```

只有发布且启用的 Skill 能被 Agent 发现。新草稿不会中断旧发布 revision 的读取。

### 7.2 浏览器能力

用户可以：

- 创建用户 Skill；
- 查看草稿、当前发布版和不可变历史 revision；
- 编辑名称、slug、description、`SKILL.md` 和 references；
- 保存草稿；
- 查看校验问题并定位文件；
- 发布准确 revision；
- 禁用和重新启用；
- 软删除和恢复。

用户 Skill 软删除后，其 slug 继续保留；创建同名 Skill 会被拒绝。用户必须恢复
原 Skill，或在删除前先完成重命名，以免安装来源身份被新内容接管。

标准 Skill 只能查看、查看历史、禁用和重新启用。服务端必须拒绝标准 Skill 的编辑、发布、重命名和删除，不能只依赖前端隐藏操作。

删除 Inspector 中的用户 Skill 不会删除 Agent 已经安装的副本，UI 必须明确说明这一点。

### 7.3 项目范围

用户 Skill 只属于当前项目。3.7.0 不增加全局用户 Skill。跨项目复用通过项目导出和导入完成。

## 8. Skill Bundle 与校验

### 8.1 硬限制

```text
每个 Skill 最多文件数：64
单个 Markdown 文件最大：256 KiB
完整 Bundle 最大：1 MiB
slug 最大长度：63
展示名称最大长度：120
description 最大长度：1,024
reference 路径最大长度：512
列表默认页大小：50
列表最大页大小：100
```

### 8.2 文件规则

- 根目录必须存在且只能存在一个 `SKILL.md`；
- 其他文件只能位于 `references/` 下且扩展名为 `.md`；
- 文件内容必须是合法 UTF-8 文本；
- 路径必须使用相对 POSIX 格式；
- 拒绝绝对路径、空段、`.`、`..`、反斜杠、控制字符和隐藏文件；
- 拒绝大小写折叠后冲突的路径；
- 不接受符号链接或外部引用；
- Markdown 预览不得执行 HTML、脚本或外部资源。

### 8.3 `SKILL.md` 规则

- 必须包含 YAML frontmatter；
- frontmatter 必须包含 `name` 与 `description`；
- `name` 必须与 Skill slug 一致；
- `description` 必须描述适用触发条件，不得为空；
- 不认识的安全文本字段可以按兼容规则保留；
- 不允许通过 frontmatter 声明脚本、可执行依赖或 Inspector 权限升级；
- Skill 文本不得包含已识别的 Inspector Token、连接凭据或环境变量秘密值。

### 8.4 Digest

Digest 输入包含固定格式版本、按路径排序的文件路径、每个路径的 UTF-8 字节长度和内容。文件输入顺序不影响 digest；路径或内容的任意变化必须改变 digest。

## 9. Skills UI

左侧增加独立一级 `Skills` 导航。页面使用现有主从模式：

```text
Skills
├── 左侧
│   ├── 搜索
│   ├── 全部 / 标准 / 用户创建
│   ├── 已发布 / 草稿 / 已禁用
│   └── Skill 列表
└── 右侧
    ├── 基本信息
    ├── SKILL.md
    ├── references 文件列表与编辑器
    ├── 校验结果
    ├── revision 历史
    └── 可用操作
```

标准 Skill 详情显示名称、slug、标准来源、版本、description、内容、references、digest、历史 revisions 和启用状态，不显示编辑或删除操作。

用户 Skill 编辑器支持基本信息、`SKILL.md`、Markdown reference 新建/重命名/编辑/删除、保存草稿、校验、发布、禁用、软删除和恢复。

页面状态至少绑定 `projectId + skillId + revision + selectedFile + requestGeneration`。切换项目时必须清除旧项目列表、选择、草稿、文件选择和迟到异步响应。

来源、草稿、发布、禁用、废弃和删除状态必须使用可见文本，不能只靠颜色。文件列表、编辑、发布和错误定位支持键盘操作。所有文案提供 `zh-CN` 与 `en-US`。

## 10. 浏览器接口

浏览器 Session 认证的内部接口提供用户管理：

```text
GET    /api/projects/:projectId/skills
GET    /api/projects/:projectId/skills/:skillId
POST   /api/projects/:projectId/skills
PUT    /api/projects/:projectId/skills/:skillId
POST   /api/projects/:projectId/skills/:skillId/validate
POST   /api/projects/:projectId/skills/:skillId/publish
POST   /api/projects/:projectId/skills/:skillId/disable
POST   /api/projects/:projectId/skills/:skillId/enable
POST   /api/projects/:projectId/skills/:skillId/restore
DELETE /api/projects/:projectId/skills/:skillId
```

创建、修改、发布、状态变更和删除接受 idempotency key；除创建外还要求准确 `expectedRevision`。项目和 Skill 身份必须从持久化关系校验，不能只信任 URL 或请求正文。

## 11. Authoring MCP 接口

3.7.0 的 Agent 接口保持只读：

```text
inspector_list_skills
inspector_get_skill
inspector_get_skill_file
```

### 11.1 `inspector_list_skills`

输入包含 `projectId`、可选 query、可选 origin、cursor 和 limit。默认 50，最大 100。Cursor 绑定项目、规范化过滤条件和稳定排序。

只返回当前项目中已发布且启用的 Skills。Summary 至少包含：

```ts
interface AgentSkillSummary {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  origin: "STANDARD" | "USER";
  version: string;
  revision: number;
  digest: string;
  updatedAt: string;
}
```

### 11.2 `inspector_get_skill`

输入：

```ts
interface GetSkillInput {
  projectId: string;
  skillId: string;
  revision?: number;
}
```

未指定 revision 时返回当前发布 revision；指定 revision 时返回准确不可变历史 revision。结果包含 Skill metadata、Bundle digest 和有界文件清单，不默认返回所有正文。

### 11.3 `inspector_get_skill_file`

输入：

```ts
interface GetSkillFileInput {
  projectId: string;
  skillId: string;
  revision: number;
  path: string;
  expectedDigest: string;
}
```

`expectedDigest` 是 Bundle digest。服务端确认项目、Skill、revision、发布可见性、路径和 digest 后返回 UTF-8 文本、文件大小与文件 digest。

Agent 可以在当前会话直接读取内容，也可以自行安装：

```text
Agent 拉取 Skill
→ 检查项目/.agents/skills/
→ 由 Agent 客户端申请文件写权限
→ Agent 写入 Skill 和来源标记
```

Inspector 不保证安装后当前 Agent 会话立即重新发现 Skill；该行为取决于 Agent 客户端。

建议 Agent 在安装副本中写入 `.mcp-inspector-skill.json`，记录 `skillId`、origin、version、revision 和 digest。该文件由 Agent 管理，Inspector 不读取或写入。

## 12. 首批标准 Skills

### 12.1 `using-mcp-inspector`

当任务涉及 Inspector 的 Tool 发现、诊断、测试编写、验证、运行证据或测试套件，而 Agent 需要选择工作流时使用。它是轻量路由 Skill，不复制其他 Skill 的完整流程。

### 12.2 `authoring-tool-tests`

当用户要求为一个 Tool 创建或保存自动化测试时使用。要求读取真实 Tool Schema，区分参数来源，生成有依据的断言，创建 Draft、校验、按用户要求试运行，并保存为未启用正式测试。

### 12.3 `authoring-scenario-tests`

当一个业务目标需要按顺序调用多个 Tool、传递步骤结果、轮询或执行清理时使用。要求生成 Scenario inputs、steps、mappings、extractors、assertions、polling 和 cleanup，并遵守 Draft revision 与验证冻结。

目录：

```text
authoring-scenario-tests/
├── SKILL.md
└── references/
    ├── scenario-model.md
    ├── data-flow-and-assertions.md
    └── mapping-update-example.md
```

Mapping 示例使用：

```text
get_store_product_mapping
→ 提取 originalMapping

apply_product_mapping
→ 更新为 expectedMapping

get_store_product_mapping
→ 轮询并断言结果等于 expectedMapping

cleanup: apply_product_mapping
→ 恢复 originalMapping
```

示例不能假定实际参数或响应路径。Agent 必须先调用 `inspector_describe_tool`。

### 12.4 `creating-regression-tests-from-runs`

当用户要求把历史 Run、Authoring Call 或故障保存成回归测试时使用。要求基于准确身份创建 Draft、剔除秘密和不稳定字段、处理 Schema 漂移，并补充有来源的断言。

### 12.5 `validating-mcp-test-assets`

当用户要求执行并判断 Draft、Test Case 或 Suite 是否满足期望时使用。要求冻结准确 revision、读取确定性证据、区分 FAIL、ERROR 与 INCONCLUSIVE、提交受限 AI assessment，并保留人工复核边界。

### 12.6 `diagnosing-mcp-tool-runs`

当 Tool 调用失败、超时、返回异常或结果不稳定时使用。按请求、响应、HTTP、RPC、时间线、Tool 快照和当前 Schema 诊断。默认只读；未获得明确授权时不回放、不调用写 Tool，也不修改测试资产。

### 12.7 `authoring-test-suites`

当用户要求组合多个现有 Tool 或 Scenario 测试时使用。要求选择准确资产 revision，分析副作用和共享资源，配置顺序、并发与 stop-on-failure。存在步骤依赖的流程应建模为 Scenario，而不是 Suite。

## 13. 标准 Skill 编写规则

- Frontmatter description 只描述触发条件；
- `SKILL.md` 保持短小，详细模型和示例按需放入 references；
- 不硬编码项目、连接、Tool 或资产身份；
- 不猜测 Tool 参数与响应路径；
- Tool 返回文本按不可信数据处理；
- 参数秘密使用环境引用，不进入 Skill、普通日志或 Draft；
- 写操作必须评估副作用、可重复性和 cleanup；
- 最终一致性优先使用有界 polling，不使用盲目固定等待；
- 用户没有提供业务期望时，不凭空编造业务断言；
- 验证期间不修改被冻结 revision；
- 失败后的修正创建新 revision，不修改旧证据；
- Agent 不能代表浏览器用户提交人工审核决定；
- 任何重试必须有明确上限和停止条件。

## 14. 错误模型

新增稳定错误码：

```text
SKILL_NOT_FOUND
SKILL_REVISION_NOT_FOUND
SKILL_REVISION_CONFLICT
SKILL_STANDARD_READ_ONLY
SKILL_SLUG_CONFLICT
SKILL_INVALID
SKILL_NOT_PUBLISHED
SKILL_DISABLED
SKILL_FILE_NOT_FOUND
SKILL_DIGEST_MISMATCH
SKILL_TOO_LARGE
SKILL_FILE_LIMIT_EXCEEDED
SKILL_PATH_INVALID
SKILL_CONTENT_INVALID
STANDARD_SKILL_SYNC_FAILED
```

规则：

- Agent 请求未发布或禁用 Skill 时不返回内容；
- 旧 `expectedRevision` 不产生写入；
- 发布校验失败时保留原发布指针；
- 同一 idempotency key 与相同请求返回原结果，不同请求返回冲突；
- 单文件拉取失败可以按相同 revision 重试；
- digest 不匹配时不得降级为最新 revision；
- 内部错误不返回 SQL、绝对路径、Token、认证头或原始秘密内容；
- Authoring MCP 复用现有成功/失败 envelope。

## 15. 安全与权限

- Skill CRUD 仅浏览器 Session 可用；
- Authoring MCP 仅提供 Skill 只读发现与拉取；
- 所有 MCP Skill 操作绑定准确 project identity；
- 用户 Skill 明确标记 `origin: USER`，不能伪装成标准 Skill；
- 标准 Skill 的内容、身份和删除只读属性由服务端强制；项目级启用状态仍可修改；
- Skill 内容不授予执行 Tool、写文件或修改资产的权限；
- Agent 是否安装以及安装时的权限申请由 Agent 客户端负责；
- Inspector 不读写 `.agents/skills/`，不跟踪安装状态；
- Skill Markdown 不执行 HTML、脚本或外部资源；
- 文件、Bundle、查询、分页和 revision 历史读取都有硬上限；
- 用户 Skill 和 Tool 响应均可能包含提示注入文本，Agent 必须按来源与任务权限处理；
- Skill 数据进入项目导出，但不得包含 Agent 本地安装路径或权限状态；
- 普通日志、Toast 和 MCP 错误不得回显秘密内容。

## 16. 项目导入导出

- 项目导出包含标准与用户 Skills、不可变 revisions、发布指针和状态；
- 用户 Skill 完整保留；
- 导入后执行当前 Inspector 的标准 Skill 同步；
- 导入的标准版本较旧时升级到当前 seed；
- 导入的标准版本较新时旧 Inspector 不降级覆盖；
- 同一标准 version 不同 digest 标记完整性错误；
- 用户 Skill 永远不能被标准同步覆盖；
- 导出不包含 `.agents/skills/` 内容、安装路径或安装状态。

## 17. 性能与可访问性

- 1,000 个 Skill metadata 仍使用有界分页和搜索；
- 列表不预加载所有 Skill 文件正文；
- 打开 Skill 时先加载 Manifest，仅加载当前选择文件；
- 大文本编辑和预览受 256 KiB 单文件上限保护；
- 标准同步无变化时不得写数据库；
- UI 复用现有 tokens、Phosphor icons、表单和反馈组件；
- 状态不能只靠颜色表达；
- 列表、文件切换、编辑、错误定位和操作支持键盘；
- 焦点在 Dialog、删除、发布和错误跳转后可预测恢复；
- 中英文文案完整；
- 亮色、暗色和窄屏进行真实浏览器检查。

## 18. 测试策略

### 18.1 领域与校验

- 有效 `SKILL.md` 和 references；
- 缺失或重复 `SKILL.md`；
- 无效 frontmatter、name/slug 不一致；
- 绝对路径、`..`、反斜杠、隐藏文件和大小写冲突；
- 非 UTF-8、错误扩展名、文件数、单文件和 Bundle 超限；
- canonical digest 对文件顺序稳定，对路径或内容变化敏感。

### 18.2 迁移与仓储

- 从当前所有受支持历史数据库版本升级；
- 标准与用户 Skill 共享仓储但权限隔离；
- revision 与校验结果不可变、发布指针原子更新；
- 乐观并发和 idempotency；
- 标准只读、用户软删除与恢复；
- 事务失败完整回滚。

### 18.3 标准同步

- 首次 seed、重复 no-op、新版本追加；
- 同版本 digest 冲突；
- 数据库版本较新不降级；
- seed 缺失转为 deprecated；
- 单项失败导致本轮事务回滚；
- 项目仍可在同步错误后打开。

### 18.4 浏览器与 MCP

- 用户 Skill 完整 CRUD、校验和发布；
- 标准 Skill 修改与删除被服务端拒绝；
- 项目切换和迟到响应隔离；
- MCP list 搜索、过滤、分页与项目绑定；
- 当前发布 revision 与准确历史 revision；
- 分文件拉取和 digest 校验；
- 未发布、禁用、删除和跨项目读取拒绝；
- MCP 输出不泄露 Session、认证、绝对路径或秘密。

### 18.5 标准 Skill 行为测试

每个标准 Skill 使用 RED-GREEN-REFACTOR：先记录未加载 Skill 的基线 Agent 行为，再加载 Skill 执行相同压力场景，并验证可观察的不变量。

`authoring-scenario-tests` 至少验证：

- Agent 先 describe Tool，不猜 Schema；
- 顺序依赖调用生成 Scenario，不误建 Suite；
- 写操作评估 cleanup；
- 最终一致性使用有界 polling；
- inputs、mappings、extractors 和 assertions 正确分工；
- 自然语言期望形成 assertion 与 expectation claim；
- Tool 响应中的提示注入不改变工作流；
- Schema 或 revision 冲突时重新读取或停止；
- 验证期间不修改冻结 revision；
- Agent 不提交人工审核决定。

其余标准 Skills 同样覆盖正常路径、缺少 Schema、权限拒绝、秘密字段、提示注入、revision 冲突、证据截断和有限重试。

### 18.6 发布门禁

- 聚焦测试在每个任务内执行；
- 完整 `npm run verify` 通过；
- npm 包包含全部标准 Skill seed 文件；
- 发布包从干净进程可启动并同步标准 Skills；
- 项目导入导出往返保持用户 Skill；
- 真实 Agent 能发现、拉取并在获得文件权限后安装一个标准 Skill；
- 独立正确性、安全、隐私、提示注入、迁移和无障碍复核无 Critical/Required 问题。

## 19. 验收标准

3.7.0 只有在以下条件全部满足后才可发布：

1. 新旧项目均能获得七个标准 Skills，重复打开不产生重复 revision。
2. 标准与用户 Skill 存在同一项目 Registry 中，服务端严格执行不同权限。
3. 用户能完成草稿、校验、发布、禁用、删除和恢复流程。
4. Agent 只能发现已发布且启用的 Skill，并能按准确 revision 拉取全部文本文件。
5. 拉取期间发布新版本不会造成 revision 文件混合。
6. Inspector 没有安装 Tool，不读写 `.agents/skills/`，也不展示虚假的安装状态。
7. 首批七个标准 Skills 均通过独立 Agent 行为测试。
8. `authoring-scenario-tests` 能指导 Agent 生成包含参数、期望、步骤数据流、轮询与清理的 Mapping 场景测试。
9. 用户 Skill、Tool 响应或 Markdown 中的提示注入不能提升 Inspector 权限或绕过已有安全边界。
10. 项目、连接、Tool、Run、Draft、Skill、revision、验证与复核身份不串联。
11. 所有历史数据可原地升级，导入导出兼容。
12. 完整验证、生产 E2E、包内容检查和独立复核全部通过。

## 20. 开发顺序

1. `skill-domain`
2. `skill-persistence` 与 `skill-validation`
3. `standard-skill-sync`
4. `skill-management`
5. `skill-discovery-mcp`
6. `standard-skill-library`
7. `skills-ui`
8. `skill-portability`
9. 完整发布门禁与独立复核

详细文件、测试、接口签名和提交边界由本规格批准后的实施计划定义。
