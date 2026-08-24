# DSers MCP Inspector

DSers MCP Inspector 是一款运行在测试人员电脑上的 MCP Tool 调试工作台。当前 Core 版本专注于未经认证的 Streamable HTTP MCP Server，并以类似接口调试工具的方式组织连接、Tools、请求参数、结果和协议详情。

## 环境要求与启动

需要 Node.js 22 或更高版本。

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

- 保存并连接未经认证的 Streamable HTTP MCP Server。
- 获取、搜索和查看 Tools 及其 JSON Schema 定义。
- 使用 Schema Form 或 Raw JSON 编辑 `arguments`。
- 为同一个 Tool 打开多个互相隔离且可恢复的调试 Tab。
- 执行 Tool 并自动保存 Run 历史。
- 查看格式化结果、Raw 响应、JSON-RPC、HTTP 摘要和有序时间线，并复制相关内容。

当前版本尚未提供 OAuth、Bearer Token、旧版 SSE transport、保存测试用例、回放/差异比较、项目导入导出以及跨设备同步。

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
