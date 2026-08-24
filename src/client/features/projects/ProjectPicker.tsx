import { useEffect, useState, type FormEvent } from "react";
import type { InspectorApiClient, ProjectSummary } from "../../api/api-client.js";

interface ProjectPickerProps {
  api: InspectorApiClient;
  onProjectOpened(project: ProjectSummary): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载项目";
}

export function ProjectPicker({ api, onProjectOpened }: ProjectPickerProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busyProject, setBusyProject] = useState<ProjectSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listProjects()
      .then(async (items) => {
        if (!active) return;
        const recent = items
          .filter((project) => project.lastOpenedAt !== null)
          .sort((left, right) => right.lastOpenedAt!.localeCompare(left.lastOpenedAt!))[0];
        if (recent !== undefined) {
          setProjects(items);
          setBusyProject(recent);
          const opened = await api.openProject(recent.id);
          if (active) onProjectOpened(opened);
          return;
        }
        setProjects(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setBusyProject(null);
          setError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [api, onProjectOpened]);

  async function open(project: ProjectSummary): Promise<void> {
    setError(null);
    setBusyProject(project);
    try {
      onProjectOpened(await api.openProject(project.id));
    } catch (cause) {
      setBusyProject(null);
      setError(errorMessage(cause));
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.createProject(normalizedName);
      setBusyProject(created);
      onProjectOpened(await api.openProject(created.id));
    } catch (cause) {
      setBusyProject(null);
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (error !== null && projects === null && busyProject === null) {
    return <p role="alert" className="project-error">{error}</p>;
  }

  if (projects === null || busyProject !== null) {
    return (
      <p role="status" className="project-loading">
        {busyProject === null ? "正在加载项目…" : `正在打开 ${busyProject.name}…`}
      </p>
    );
  }

  return (
    <section className="project-picker" aria-labelledby="project-picker-title">
      <h2 id="project-picker-title">选择项目</h2>
      <p>项目数据保存在本机 SQLite 中。</p>

      {error !== null && <p role="alert" className="project-error">{error}</p>}

      {projects.length > 0 && (
        <ul className="project-list" aria-label="项目列表">
          {projects.map((project) => (
            <li key={project.id}>
              <span>{project.name}</span>
              <button type="button" onClick={() => void open(project)}>
                打开 <span className="sr-only">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void create(event)} className="project-create-form">
        <label htmlFor="project-name">项目名称</label>
        <div>
          <input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
          <button type="submit" disabled={submitting || name.trim().length === 0}>
            {submitting ? "正在创建…" : "创建并打开"}
          </button>
        </div>
      </form>
    </section>
  );
}
