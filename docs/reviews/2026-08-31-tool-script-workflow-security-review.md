# Tool Script Workflows 安全与质量复审

## 结论

- 日期：2026-08-31
- 范围：QuickJS 沙箱、父子进程 IPC、helper Tool、环境变量与 secret、Workflow 幂等、取消/资源限制、持久化与打包边界
- 最终结论：**PASS**
- 未关闭 Critical：0
- 未关闭 Required：0

本次复审只修复真实安全和一致性缺陷，没有扩大脚本权限，也没有改变未启用脚本时的普通 Run 行为。

## 威胁边界

| 边界 | 主要风险 | 结论与证据 |
|---|---|---|
| Browser → Workflow API | 越权、畸形载荷、错误 connection 身份 | 共享严格 schema、路由继承现有会话认证；Tab 与 connection 不一致会拒绝 |
| API → SQLite | 跨 project/connection 读写、部分提交 | repository 查询携带 project/connection fence；环境变量只在完整 Workflow 成功后批量提交 |
| Parent → child process | Node 能力或宿主环境意外暴露 | child 仅收到最小 `NODE_ENV`，stdin/stdout/stderr 禁用，只开放版本化 IPC |
| child process → QuickJS | import、网络、文件、动态代码、原型污染 | QuickJS allowlist SDK；无 `process`/`require`/`fetch`；import、动态构造器和 prototype path 回归均通过 |
| QuickJS → Parent IPC | 重复/错误方向消息、日志/调用/输出过量 | 父进程现独立校验方向、重复 requestId、调用次数、日志次数/字节与消息输出上限；恶意 Worker 回归通过 |
| Script → helper Tool | 递归、破坏性调用、连接误选、secret 参数泄漏 | helper 仅通过普通 child Run；破坏性 Tool 需显式授权；connection ID 优先，重名 Server 拒绝；secret-bearing 参数拒绝 |
| Environment → logs/Run/export | secret 明文或结构化 secret 子字段泄漏 | secret 及其嵌套标量统一收集、最长优先脱敏；禁止把 secret 降级写为非 secret 变量 |
| Cancel/close → child/Run | late event、遗留进程、半终态 | AbortSignal 贯穿 helper Run；terminal/close 测试与完整验证正常退出，无 retained handle |

## 已关闭 Required

1. **结构化 secret 子字段可泄漏**  
   原实现只把整个对象序列化结果作为 secret token；脚本读取 `credentials.token` 后可写入日志或 Tool 参数。现在递归收集结构化 secret 的标量值，并在日志、终态、helper/main arguments 边界复用同一安全模块。

2. **同名 helper Server 会任意选择第一条连接**  
   原实现按 `id || name` 使用 `find`，重名 Server 可能串用错误认证。现在 selector 为 connection ID 时精确命中；按名称匹配必须唯一，否则 fail-closed。

3. **secret 可被脚本降级持久化为普通变量**  
   原实现允许读取 secret 后以 `{ secret: false }` staged commit。现在 before/after 的 staged mutation 在任何持久化前都会检查；包含已知 secret 的非 secret mutation 使整个 Workflow 失败且不启动后续调用。

4. **幂等 key 未绑定破坏性 helper 授权**  
   原实现可用相同 idempotency key、相同参数复用不同 `allowDestructiveHelpers` 语义。现在授权位进入不可变 Workflow snapshot，并参与幂等冲突判断。

5. **父进程未独立执行 IPC 资源与方向校验**  
   原实现依赖 Worker 自己限制日志和 Tool 调用，且接受合法但方向错误的消息。现在父进程独立执行 message 字节、日志数/字节、调用数、requestId 唯一性、pending-call completion 和方向校验。

## 五轴审查

| 轴 | 结果 |
|---|---|
| Spec | PASS；与 `SPEC-tool-script-workflows.md` 的隔离、限制、secret、helper Run 和失败语义一致 |
| Correctness | PASS；canonical arguments、最终 Schema 校验、全成功后变量提交和幂等语义均有回归 |
| Security | PASS；未发现未关闭 Critical/Required |
| Regression | PASS；普通 Run、Tab、history、同 URL 不同 connection 认证隔离的既有门禁全部通过 |
| Maintainability | PASS；debug/execution 共用 `workflow-security.ts`，未复制连接解析或 secret 规则 |

## 验证证据

- Workflow focused：23/23
- 完整 Vitest：66 files / 570 tests
- Playwright production E2E：2/2
- `npm run verify`：PASS
- `npm pack --dry-run --json`：PASS，19 个 allowlisted 文件，包含 production script worker 与 migrations 001–011
- `git diff --check`：PASS
- 生产依赖使用 lockfile 精确记录；`quickjs-emscripten` 生产依赖固定为 `0.32.0`

说明：本轮尝试重新调用远程 `npm audit` 时，执行环境因该命令会把依赖元数据发送到当前配置的外部 registry 而拒绝授权；未绕过该限制。脚本功能原 Task 10 已有通过的 dependency audit 记录，本轮通过 lockfile、完整构建、打包内容和运行测试复核依赖边界。
