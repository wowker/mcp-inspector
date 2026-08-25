import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { InspectorApiClient, RunSummary } from "../../api/api-client.js";
import { RunHistory } from "./RunHistory.js";
import { RunResultPanel } from "./RunResultPanel.js";
import { useRunEvents } from "./use-run-events.js";

export function RunHistoryPage({ api, projectId }: { api: InspectorApiClient; projectId: string }) {
  const [selected, setSelected] = useState<RunSummary | null>(null);
  const observed = useRunEvents(api, projectId, selected?.id ?? null);

  return <section className="history-page" aria-labelledby="history-page-title">
    <header className="page-heading page-heading--compact history-page__heading">
      <div><h1 id="history-page-title">运行历史</h1><p>查看项目内所有 Tool 调用，按时间回溯请求、响应和协议轨迹。</p></div>
    </header>
    <div className="history-page__layout">
      <aside className="history-page__list" aria-label="运行记录列表">
        <RunHistory api={api} projectId={projectId} onOpen={setSelected} hideHeading compactId />
      </aside>
      <div className="history-page__detail">
        {selected === null ? <div className="history-page__empty" role="status">
          <ClockCounterClockwise size={24} aria-hidden="true" />
          <div><strong>选择一条运行记录</strong><p>请求参数、响应结果、RPC、HTTP 与时间线会显示在这里。</p></div>
        </div> : observed.error !== null ? <p role="alert">{observed.error}</p>
          : observed.run === null ? <p role="status">正在加载运行详情…</p>
          : <RunResultPanel run={observed.run} />}
      </div>
    </div>
  </section>;
}
