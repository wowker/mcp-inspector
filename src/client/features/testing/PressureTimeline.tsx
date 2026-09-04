import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { PressureTestSample } from "../../../shared/testing/pressure-test.js";

interface Bucket { time: string; requests: number; averageDurationMs: number }

function bucketsOf(samples: PressureTestSample[]): Bucket[] {
  const buckets = new Map<string, { requests: number; durationMs: number }>();
  for (const sample of samples) {
    const time = sample.startedAt.slice(0, 19);
    const current = buckets.get(time) ?? { requests: 0, durationMs: 0 };
    current.requests += 1;
    current.durationMs += sample.durationMs;
    buckets.set(time, current);
  }
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([time, value]) => ({
    time, requests: value.requests, averageDurationMs: Math.round(value.durationMs / value.requests),
  }));
}

function points(values: number[], width: number, height: number): string {
  const maximum = Math.max(1, ...values);
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index * width / (values.length - 1);
    return `${x.toFixed(1)},${(height - value * height / maximum).toFixed(1)}`;
  }).join(" ");
}

export function PressureTimeline({ samples }: { samples: PressureTestSample[] }) {
  const { t } = useTranslation("testing");
  const titleId = useId();
  const buckets = bucketsOf(samples);
  if (buckets.length === 0) return null;
  const width = 600; const height = 96;
  return <section className="pressure-timeline" aria-labelledby={titleId}>
    <div className="pressure-timeline__heading"><h4 id={titleId}>{t("pressure.timeline")}</h4>
      <span><i className="pressure-timeline__legend pressure-timeline__legend--rps" />{t("pressure.timelineRps")}</span>
      <span><i className="pressure-timeline__legend pressure-timeline__legend--duration" />{t("pressure.timelineDuration")}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("pressure.timelineAria")}>
      <polyline className="pressure-timeline__rps" points={points(buckets.map(({ requests }) => requests), width, height)} />
      <polyline className="pressure-timeline__duration" points={points(buckets.map(({ averageDurationMs }) => averageDurationMs), width, height)} />
    </svg>
    <div className="pressure-timeline__table"><table><caption className="sr-only">{t("pressure.timelineTable")}</caption>
      <thead><tr><th scope="col">{t("pressure.timelineTime")}</th><th scope="col">{t("pressure.timelineRps")}</th>
        <th scope="col">{t("pressure.timelineDuration")}</th></tr></thead>
      <tbody>{buckets.slice(-20).map((bucket) => <tr key={bucket.time}><td>{bucket.time.replace("T", " ")}</td>
        <td>{bucket.requests}</td><td>{bucket.averageDurationMs} ms</td></tr>)}</tbody></table></div>
  </section>;
}
