import { useEffect, useMemo, useState } from "react";
import { EyeSlash, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { confirmToast } from "../../app/AppToaster.js";
import type { ConnectionSummary, EnvironmentVariable, InspectorApiClient } from "../../api/api-client.js";
import "./environment-variables.css";

interface Props {
  api: InspectorApiClient;
  projectId: string;
}

type Scope = "project" | "server";
type ValueMode = "text" | "json";

function visibleValue(variable: EnvironmentVariable): string {
  return variable.secret ? "••••••••" : JSON.stringify(variable.value);
}

export function EnvironmentVariablesPage({ api, projectId }: Props) {
  const [scope, setScope] = useState<Scope>("project");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [projectVariables, setProjectVariables] = useState<EnvironmentVariable[]>([]);
  const [serverVariables, setServerVariables] = useState<EnvironmentVariable[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);
  const [valueMode, setValueMode] = useState<ValueMode>("text");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listConnections(projectId), api.listEnvironmentVariables(projectId, null)])
      .then(([loadedConnections, variables]) => {
        if (!active) return;
        const safeConnections = Array.isArray(loadedConnections) ? loadedConnections : [];
        setConnections(safeConnections);
        setConnectionId((current) => safeConnections.some(({ id }) => id === current)
          ? current
          : safeConnections[0]?.id ?? "");
        setProjectVariables(Array.isArray(variables) ? variables : []);
      })
      .catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : "加载环境变量失败"); });
    return () => { active = false; };
  }, [api, projectId]);

  useEffect(() => {
    if (connectionId === "") { setServerVariables([]); return; }
    let active = true;
    void api.listEnvironmentVariables(projectId, connectionId).then((variables) => {
      if (active) setServerVariables(Array.isArray(variables) ? variables : []);
    }).catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : "加载 Server 变量失败"); });
    return () => { active = false; };
  }, [api, connectionId, projectId]);

  const variables = scope === "project" ? projectVariables : serverVariables;
  const projectNames = useMemo(() => new Set(projectVariables.map((item) => item.name)), [projectVariables]);

  function resetEditor(): void {
    setName(""); setValue(""); setSecret(false); setValueMode("text");
  }

  function edit(variable: EnvironmentVariable): void {
    setName(variable.name);
    setSecret(variable.secret);
    setValue(variable.secret ? "" : typeof variable.value === "string" ? variable.value : JSON.stringify(variable.value, null, 2));
    setValueMode(!variable.secret && typeof variable.value !== "string" ? "json" : "text");
  }

  async function save(): Promise<void> {
    const normalizedName = name.trim();
    if (normalizedName === "") { toast.error("请输入变量名称"); return; }
    if (scope === "server" && connectionId === "") { toast.error("请先选择 Server"); return; }
    let parsed: unknown = value;
    if (valueMode === "json") {
      try { parsed = JSON.parse(value); } catch { toast.error("变量值不是有效 JSON"); return; }
    }
    setBusy(true);
    try {
      const owner = scope === "server" ? connectionId : null;
      const saved = await api.setEnvironmentVariable(projectId, owner, normalizedName, { value: parsed, secret });
      if (scope === "project") setProjectVariables((items) => [...items.filter((item) => item.name !== saved.name), saved]);
      else setServerVariables((items) => [...items.filter((item) => item.name !== saved.name), saved]);
      resetEditor();
      toast.success("环境变量已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存环境变量失败");
    } finally { setBusy(false); }
  }

  function remove(variable: EnvironmentVariable): void {
    confirmToast({
      message: `删除环境变量 ${variable.name}？`,
      description: "引用此变量的连接或脚本可能无法继续执行。",
      actionLabel: "删除",
      cancelLabel: "取消",
      onAction: () => {
        setBusy(true);
        void api.deleteEnvironmentVariable(projectId, variable.connectionId, variable.name).then(() => {
          if (variable.connectionId === null) setProjectVariables((items) => items.filter(({ id }) => id !== variable.id));
          else setServerVariables((items) => items.filter(({ id }) => id !== variable.id));
          toast.success("环境变量已删除");
        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "删除环境变量失败"))
          .finally(() => setBusy(false));
      },
    });
  }

  return <section className="environment-page" aria-labelledby="environment-page-title">
    <header className="page-heading environment-page__heading">
      <div><h1 id="environment-page-title">环境变量</h1><p>集中管理连接认证与脚本可复用的配置值。</p></div>
    </header>
    <div className="environment-page__scope" role="tablist" aria-label="变量作用域">
      <button type="button" role="tab" aria-selected={scope === "project"} onClick={() => setScope("project")}>项目变量</button>
      <button type="button" role="tab" aria-selected={scope === "server"} onClick={() => setScope("server")}>Server 变量</button>
      {scope === "server" && <label>Server
        <select className="ui-input" aria-label="选择 Server" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
          {connections.length === 0 && <option value="">暂无 Server</option>}
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
        </select>
      </label>}
    </div>
    <p className="environment-page__hint">在 Header 或 Bearer Token 中使用 <code>{"{{VARIABLE_NAME}}"}</code>；也可保留直接值。Server 同名变量会覆盖项目变量，解析后的值不会写回连接配置。</p>
    <div className="environment-editor">
      <label>名称<input className="ui-input" aria-label="环境变量名称" placeholder="例如 API_TOKEN" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>值<input className="ui-input" aria-label="环境变量值" type={secret ? "password" : "text"} placeholder={secret ? "输入敏感值" : "输入变量值"} value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label>类型<select className="ui-input" aria-label="变量值类型" value={valueMode} onChange={(event) => setValueMode(event.target.value as ValueMode)}>
        <option value="text">文本</option><option value="json">JSON</option>
      </select></label>
      <label className="environment-editor__secret"><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} />敏感值</label>
      <button className="ui-button ui-button--primary" type="button" disabled={busy} onClick={() => void save()}><Plus size={15} aria-hidden="true" />保存变量</button>
    </div>
    <div className="environment-table-wrap">
      <table className="environment-table"><thead><tr><th>名称</th><th>值</th><th>作用域</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{variables.map((variable) => <tr key={variable.id}><th><code>{variable.name}</code>{scope === "server" && projectNames.has(variable.name) && <small>覆盖项目值</small>}</th>
          <td><code>{visibleValue(variable)}</code>{variable.secret && <EyeSlash size={15} aria-label="敏感值已隐藏" />}</td>
          <td>{variable.connectionId === null ? "项目" : connections.find(({ id }) => id === variable.connectionId)?.name ?? "Server"}</td>
          <td>{new Date(variable.updatedAt).toLocaleString()}</td>
          <td><button type="button" aria-label={`编辑变量 ${variable.name}`} onClick={() => edit(variable)}><PencilSimple size={16} /></button>
            <button type="button" aria-label={`删除变量 ${variable.name}`} disabled={busy} onClick={() => remove(variable)}><Trash size={16} /></button></td></tr>)}</tbody></table>
      {variables.length === 0 && <p className="environment-table__empty">当前作用域尚未配置变量。</p>}
    </div>
  </section>;
}
