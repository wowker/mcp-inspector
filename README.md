# MCP Inspector

MCP Inspector 是一款运行在测试人员电脑上的 MCP Tool 调试工作台。当前版本支持无认证与 OAuth 的 Streamable HTTP MCP Server，并以类似接口调试工具的方式组织连接、Tools、请求参数、结果和协议详情。

## 环境要求与启动

需要 Node.js 22 或更高版本。

发布到 npm 后可直接运行：

```bash
npx --yes @wuwei0215/mcp-inspector@latest
```

也可以从源码安装并启动：

```bash
npm install
npm run build
npm start
```

也可以使用 Makefile 一键安装缺失依赖、重新编译并后台重启：

```bash
make
# 等同于 make restart
```

常用进程管理命令：

```bash
make status   # 查看运行状态
make logs     # 实时查看日志，按 Ctrl-C 退出
make stop     # 优雅停止当前项目启动的 Inspector
```

服务只监听 `127.0.0.1`，启动后会打开本地浏览器。每次进程启动都会生成新的随机会话令牌；浏览器首次进入后会把令牌从地址栏移入当前标签页的 session storage。请勿把启动页面地址分享给其他人。

项目、连接、调试 Tab、请求草稿、运行结果和协议事件保存在本机 SQLite 数据库中。

## 当前已交付的 Core 能力

- 保存并连接无认证或 OAuth 自动授权的 Streamable HTTP MCP Server。
- 获取、搜索和查看 Tools 及其 JSON Schema 定义。
- 使用 Schema Form 或 Raw JSON 编辑 `arguments`。
- 为同一个 Tool 打开多个互相隔离且可恢复的调试 Tab。
- 执行 Tool 并自动保存 Run 历史。
- 查看格式化结果、Raw 响应、JSON-RPC、HTTP 摘要和有序时间线，并复制相关内容。
- 为单个 Tool 配置隔离的前置/后置 JavaScript 脚本、环境变量和可追溯的流水线执行。

当前版本支持无认证、Bearer Token、自定义 Header 和 OAuth 自动授权的 Streamable HTTP MCP 连接。OAuth 使用浏览器授权、PKCE、受保护资源发现和动态客户端注册；访问令牌仅保存在 Inspector 服务进程内，重启后需要重新授权，不会写入 SQLite、导出数据或浏览器存储。

## Tool 前置与后置脚本

在 Tool 调试 Tab 的“脚本”页可以配置：

- `before`：主 Tool 执行前运行，可读取、设置和删除本次 `arguments`，也可调用辅助 Tool。
- `after`：主 Tool 成功后运行，可读取主 Tool 的完整 `response`、调用辅助 Tool，并暂存环境变量。
- “校验语法”只编译脚本；“试运行”在隔离沙箱中执行单段脚本，不调用主 Tool，也不会提交暂存的环境变量。
- 只要前置或后置脚本启用，调试页使用“执行流水线”；全部禁用时继续走原有 Run 调用路径。

脚本使用 ES2022 JavaScript，必须导出一个默认函数：

```js
export default async function before(ctx) {
  const profile = await ctx.tools.call({
    server: "current",
    name: "get_account_profile",
    arguments: {},
  });
  ctx.arguments.set("account_id", ctx.json.get(profile, "$.structuredContent.account_id"));
  ctx.log.info("account prepared", { accountId: ctx.arguments.get("account_id") });
}
```

允许的 SDK：

- `ctx.arguments.get/set/remove/all()`：操作主 Tool 参数；后置阶段参数只读。
- `ctx.tools.call({ server, name, arguments })`：通过 Inspector 的正常 Run 链路调用辅助 Tool；辅助调用不会递归执行自己的脚本。
- `ctx.response`：后置阶段的主 Tool MCP 响应。
- `ctx.variables.get/set/remove/all()`：仅当前流水线存在的临时 JSON 变量。
- `ctx.env.get/set()`：读取项目/Server/执行级环境变量；项目与 Server 写入会暂存，只有 before、主 Tool、after 全部成功后才原子提交。
- `ctx.json.get(value, path)`：支持 `$`、点号属性和数组下标的确定性路径子集，例如 `$.structuredContent.items[0].id`。
- `ctx.assert.true/equal/deepEqual/exists/notEmpty/match()`：失败时终止流水线。
- `ctx.log.debug/info/warn/error()` 与 `console.*`：按顺序写入父流水线日志。

脚本在独立 QuickJS 子进程中运行，不能访问 Node.js、网络、文件系统、动态 import、`eval` 或宿主全局。单段默认超时可在 UI 中设置（100–60,000 ms），运行时还限制内存、栈、日志体积/数量和辅助 Tool 调用次数。取消流水线会终止当前沙箱并取消正在等待的 Run；任何阶段失败都不会提交环境变量。

敏感环境变量不会在列表、试运行结果、父流水线日志或导出数据中回显。为避免明文 secret 进入持久化 Run，脚本不得把敏感变量值写入主 Tool 或辅助 Tool 的 `arguments`。Tool 的实际业务副作用无法由 Inspector 回滚，因此试运行辅助 Tool 或执行流水线前仍应确认目标 Tool 的语义。

## 开发与验证

开发模式同时启动本地 API 和 Vite 客户端：

```bash
npm run dev
```

运行类型检查、全部单元/集成测试、生产构建和真实浏览器端到端测试：

```bash
npm run verify
```

端到端测试使用本机安装的 Google Chrome，并只访问临时的回环 Inspector 与 MCP fixture。

## npm 发布

发布只使用 npm 官方仓库 `https://registry.npmjs.org/`。版本遵循 SemVer：不兼容变更使用 `major`，向后兼容的新功能使用 `minor`，向后兼容的问题修复使用 `patch`。

后续版本发布前，先提交完所有改动并确保 Git 工作区干净，然后执行：

```bash
make release-version BUMP=minor  # 可替换为 major 或 patch；会创建版本提交和 vX.Y.Z tag
make release-check               # 身份、tag、测试、E2E、安全审计和打包预检
git push --follow-tags           # 保存发布提交和 tag
make publish CONFIRM=publish     # 再次完成全部门禁后正式发布
```

首次发布当前 `0.1.0` 时无需再次修改版本号。在提交完所有改动后创建现有版本的 tag，再执行相同的检查和发布步骤：

```bash
git tag -a v0.1.0 -m "Release 0.1.0"
make release-check
git push origin main v0.1.0
make publish CONFIRM=publish
```

`make publish` 默认拒绝执行，只有显式提供 `CONFIRM=publish` 才会调用 `npm publish`。npm 已发布的版本不可覆盖；发布失败或需要修复时应生成新的 `patch` 版本，不要移动已经推送的 release tag。
