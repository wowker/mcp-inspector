# MCP Inspector 未完成项 — 总执行清单

> 详细说明、依赖、验收和风险见 [project-roadmap-plan.md](./project-roadmap-plan.md)。
> 本清单不覆盖现有 [todo.md](./todo.md) 的运行历史与回放任务。

## Phase 0：质量与安全基线

- [x] Task 1：稳定当前完整验证门禁
- [x] Task 2：关闭脚本流水线独立安全审查

### Checkpoint A

- [x] `npm run verify` 稳定通过且无 open handle
- [x] 脚本五轴与威胁模型审查无 Critical/Required
- [x] 人工确认进入参数编辑器阶段

## Phase 1：参数编辑器第二阶段

- [x] Task 3：实现有界嵌套 object 编辑
- [x] Task 4：实现可判定 oneOf/anyOf 分支编辑

### Checkpoint B

- [x] Form、局部 Raw、整份 Raw 共用 canonical arguments
- [x] Skip、脚本延迟校验、历史恢复和无参数 Tool 无回归
- [x] `npm run verify` 通过

## Phase 2：最小 UI Foundation

- [x] Task 5：建立内部 Action、Status 和 Disclosure primitives
- [x] Task 6：建立 Overlay、FormField 和 Select primitives
- [x] Task 7：扩展双语覆盖并拆分大型前端模块

### Checkpoint C

- [x] 新功能只依赖内部 UI Foundation
- [x] 新增流程完整支持 `zh-CN` 与 `en-US`
- [x] 深浅主题、键盘、滚动和焦点门禁通过
- [x] 确认 Server 删除测试依赖时默认阻止删除并先处理依赖
- [x] 确认 1.5.0 排除 CLI/CI Runner

## Phase 3：自动化测试 1.5.0

- [x] Task 8：锁定测试共享契约与 migration 012
- [x] Task 9：交付测试定义 CRUD 与断言引擎
- [x] Task 10：交付单 Tool 测试编辑器
- [x] Task 11：通过 Run/Workflow 执行单 Tool 测试
- [x] Task 12A：交付场景定义与编辑器
- [x] Task 12B：交付场景 runner 与报告
- [x] Task 13：交付测试套件与有限并发
- [x] Task 14A：交付测试报告与显式基线更新
- [x] Task 14B：交付导入导出与 1.5 发布门禁

### Checkpoint D

- [x] migration 001–013 source/dist byte-match
- [x] 同 URL 不同 connection 不串认证
- [x] 无 secret 出现在 URL、Toast、日志、默认导出和浏览器存储
- [x] `npm run verify` 与 `npm pack --dry-run --json` 通过
- [x] 独立 Spec/Quality/Security review 无 Critical/Required

## Phase 4：运行历史、回放与比较重基线

- [x] Task 15：对旧 replay plan 重新分配迁移、去重并更新门禁
- [x] 人工批准新版 `tasks/plan.md` 与 `tasks/todo.md`
- [x] 按新版计划另行执行，不直接运行旧迁移 006/007 任务

## Phase 5：2.0.0 剩余能力

- [x] Task 16A：环境 Profile schema 与解析规则
- [x] Task 16B：环境 Profile 管理与连接预览 UI
- [x] Task 16C：安全导出与兼容迁移
- [x] Task 17A：Split Pane 预设与偏好保存
- [x] Task 17B：Tool 收藏、最近使用和筛选
- [x] Task 17C：1,000 Tool 有界渲染与性能验证
- [x] Task 18：关闭 2.0 兼容、安全、性能、a11y 和发布门禁

### Final Checkpoint

- [x] 1.x SQLite 数据可原地升级且不丢失
- [x] OAuth、Bearer、Header、无认证 fixture 全部通过
- [x] 双语、深浅主题和完整键盘路径通过
- [x] JS/CSS/Tool/JSON 性能预算通过
- [x] `npm run verify`、package allowlist、migration matrix 全部通过
- [x] 独立审查无 Critical/Required（同一独立 reviewer 已批准当前 RC：0 Critical / 0 Required / 0 Recommended）
- [ ] 人工批准 2.0 发布候选
