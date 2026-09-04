# MCP Inspector 2.5.1 执行清单

> 规格：[`docs/UPGRADE-2.5.1.md`](../docs/UPGRADE-2.5.1.md)
>
> 计划：[`tasks/upgrade-2.5.1-plan.md`](./upgrade-2.5.1-plan.md)

## Phase 1：契约与指标

- [x] Task 1：定义共享契约和边界。
- [x] Task 2：实现确定性聚合与阈值计算。
- [x] RED/GREEN 测试覆盖负载上限、分位数、RPS 和熔断。

## Phase 2：方案持久化

- [x] Task 3：新增迁移 020 与 Repository。
- [x] Task 4：交付定义 Service、Routes 和客户端 API。
- [x] CRUD、软删除、revision、分页和项目隔离通过。

## Phase 3：执行引擎

- [x] Task 5：实现有界闭环调度器。
- [x] Task 6：实现执行、样本、幂等和唯一活动任务持久化。
- [x] Task 7：接入 Test Execution、破坏性确认、熔断和终态汇总。
- [x] 取消、到期、最大迭代、重启中断和迟到完成语义通过。

## Phase 4：UI

- [x] Task 8：新增压力测试导航与编辑器。
- [x] Task 9：交付实时指标、停止和样本列表。
- [x] Task 10：测试报告页增加压力报告。
- [x] zh-CN/en-US、键盘、焦点、状态文案、窄屏和深色通过。
- [x] 任一时刻最多加载一个完整 Test Execution/Run 详情。

## Phase 5：发布

- [x] Task 11：完成安全、隐私和性能收口。
- [x] Task 12：完成 2.5.1 版本与发布门禁。
- [x] `npm run verify` 通过。
- [x] `npm run verify:release-artifacts` 通过。
- [x] `npm pack --dry-run --json` 通过。
- [x] `git diff --check` 通过。
- [x] 无开放 Critical/Required 审查问题。
- [ ] 人工确认并批准 2.5.1 发布。
