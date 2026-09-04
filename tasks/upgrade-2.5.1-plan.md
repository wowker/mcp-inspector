# MCP Inspector 2.5.1 开发计划

## Overview

交付一个本地、单节点、受控的压力测试模块。用户复用已保存测试用例配置闭环负载，获得实时指标、阈值结论、历史报告和代表性调用详情。权威规格为 `docs/UPGRADE-2.5.1.md`。

## Architecture Decisions

- Pressure Test 是独立资源，不复用 Suite 的 `concurrency` 字段。
- 首版目标为 Test Case，不支持 Suite，避免嵌套并发。
- 调度复用 Test Execution 行为保证脚本、断言、认证和快照一致；总迭代硬限制为 1,000。
- 聚合是报告事实，完整调用详情通过有界样本引用既有执行链。
- 单项目唯一活动任务、幂等启动和破坏性确认由服务端强制。
- 不增加图表依赖；复用 React、项目 tokens、Phosphor 和现有报告组件。

## Dependency Graph

```text
共享契约与指标语义
  ├─ 迁移/Repository
  │    └─ 调度与执行服务
  │         └─ Routes/API client
  │              ├─ 压测编辑与实时 UI
  │              └─ 压力报告 UI
  └─ 指标/阈值纯函数测试 ─────────┘
```

## Task List

### Phase 1: Contract and measurement core

- Task 1：定义 Pressure Test、Execution、Summary、Threshold 和 Sample 共享契约。
- Task 2：用确定性测试实现分位数、RPS、阈值和熔断聚合器。

Checkpoint A：非法负载被拒绝；相同样本始终产生相同 P50/P95/P99 和阈值结论。

### Phase 2: Durable definition slice

- Task 3：增加迁移 020 和 Pressure Test Repository，支持 CRUD、软删除和 revision。
- Task 4：交付定义 Service、Routes 和 API client，完成目标/输入/项目身份验证。

Checkpoint B：可以创建、修改、分页列出和软删除压力方案；历史引用不受删除影响。

### Phase 3: Execution slice

- Task 5：实现有界闭环调度器，覆盖升压、持续时间、思考时间、最大迭代和取消。
- Task 6：实现执行持久化、幂等启动、唯一活动任务、样本分页和重启中断。
- Task 7：接入 Test Execution，完成破坏性确认、阈值熔断和最终汇总。

Checkpoint C：实际并发不超过 VU，取消/到期后不再认领；跨项目和重复启动安全失败。

### Phase 4: Product UI

- Task 8：新增 Pressure Tests 导航和方案编辑器，覆盖配置、输入、安全确认和草稿隔离。
- Task 9：交付实时执行区，展示状态、指标、停止和代表样本。
- Task 10：在测试报告页增加压力报告，并复用单一调用详情。

Checkpoint D：桌面和窄屏可用；键盘、焦点、读屏状态完整；任何时刻只加载一个完整详情。

### Phase 5: Hardening and release

- Task 11：完成大型样本、请求隔离、无界增长和安全隐私测试。
- Task 12：补齐 E2E、变更日志、2.5.1 版本、发布制品与最终审查。

Checkpoint E：`npm run verify`、制品检查、打包预检和 `git diff --check` 全部通过。

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Test Execution/Run 持久化造成磁盘增长 | 高 | 1,000 次硬上限、清晰容量提示、报告只加载代表样本；后续版本再设计摘要执行模式 |
| VU 与场景内部调用叠加压力 | 高 | UI 展示目标场景调用数提示；服务端限制 VU，单项目只允许一个活动任务 |
| 调度计时测试不稳定 | 中 | 注入 clock/sleep，单元测试使用确定性假时钟，不依赖真实等待 |
| 实时轮询压垮 SQLite/UI | 中 | 固定有界轮询、摘要查询、样本分页、请求版本隔离 |
| 破坏性 Tool 被重复调用 | 高 | 默认拒绝，批次级显式确认，服务端每次启动重新检查目标快照 |
| 分位数定义产生歧义 | 中 | 使用 nearest-rank，契约和测试固定算法 |

## Implementation Notes

- 每个任务先写失败测试，再写最小实现。
- 每 2–3 个任务跑聚焦测试和 typecheck，并建立原子提交。
- 不修改 001–019 迁移，不引入新依赖，不改变现有套件调度语义。
- UI 文件超过健康边界时拆分 editor、live panel、report workspace，不构建通用表单框架。
