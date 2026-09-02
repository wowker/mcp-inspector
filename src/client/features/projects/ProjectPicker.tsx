import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient, ProjectSummary } from "../../api/api-client.js";

interface ProjectPickerProps {
  api: InspectorApiClient;
  onProjectOpened(project: ProjectSummary): void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ProjectPicker({ api, onProjectOpened }: ProjectPickerProps) {
  const { t } = useTranslation("projects");
  const loadError = useRef(t("loadFailed"));
  loadError.current = t("loadFailed");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busyProject, setBusyProject] = useState<ProjectSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback((isActive: () => boolean = () => true) => {
    setError(null);
    setBusyProject(null);
    setProjects(null);
    return api.listProjects()
      .then(async (items) => {
        if (!isActive()) return;
        const recent = items
          .filter((project) => project.lastOpenedAt !== null)
          .sort((left, right) => right.lastOpenedAt!.localeCompare(left.lastOpenedAt!))[0];
        if (recent !== undefined) {
          setProjects(items);
          setBusyProject(recent);
          const opened = await api.openProject(recent.id);
          if (isActive()) onProjectOpened(opened);
          return;
        }
        setProjects(items);
      })
      .catch((cause: unknown) => {
        if (isActive()) {
          setBusyProject(null);
          setError(errorMessage(cause, loadError.current));
        }
      });
  }, [api, onProjectOpened]);

  useEffect(() => {
    let active = true;
    void loadProjects(() => active);
    return () => {
      active = false;
    };
  }, [loadProjects]);

  async function open(project: ProjectSummary): Promise<void> {
    setError(null);
    setBusyProject(project);
    try {
      onProjectOpened(await api.openProject(project.id));
    } catch (cause) {
      setBusyProject(null);
      setError(errorMessage(cause, loadError.current));
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
      setProjects((current) => {
        const items = current ?? [];
        return items.some(({ id }) => id === created.id) ? items : [...items, created];
      });
      setBusyProject(created);
      onProjectOpened(await api.openProject(created.id));
    } catch (cause) {
      setBusyProject(null);
      setError(errorMessage(cause, loadError.current));
    } finally {
      setSubmitting(false);
    }
  }

  if (error !== null && projects === null && busyProject === null) {
    return (
      <div className="project-load-error">
        <p role="alert" className="project-error">{error}</p>
        <button type="button" onClick={() => void loadProjects()}>{t("retry")}</button>
      </div>
    );
  }

  if (projects === null || busyProject !== null) {
    return (
      <p role="status" className="project-loading">
        {busyProject === null ? t("loading") : t("opening", { name: busyProject.name })}
      </p>
    );
  }

  return (
    <section className="project-picker" aria-labelledby="project-picker-title">
      <h2 id="project-picker-title">{t("title")}</h2>
      <p>{t("description")}</p>

      {error !== null && <p role="alert" className="project-error">{error}</p>}

      {projects.length > 0 && (
        <ul className="project-list" aria-label={t("listAria")}>
          {projects.map((project) => (
            <li key={project.id}>
              <span>{project.name}</span>
              <button type="button" onClick={() => void open(project)}>
                {t("open")} <span className="sr-only">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void create(event)} className="project-create-form">
        <label htmlFor="project-name">{t("name")}</label>
        <div>
          <input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
          <button type="submit" disabled={submitting || name.trim().length === 0}>
            {submitting ? t("creating") : t("createAndOpen")}
          </button>
        </div>
      </form>
    </section>
  );
}
