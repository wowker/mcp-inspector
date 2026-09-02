export interface DescriptionSection {
  title: string;
  content: string;
}

interface DescriptionLabels {
  fallbackTitle: string;
  unavailable: string;
}

const defaultLabels: DescriptionLabels = { fallbackTitle: "Description", unavailable: "No description provided" };

export function descriptionSections(description: string | undefined, labels: DescriptionLabels = defaultLabels): DescriptionSection[] {
  const normalized = (description ?? "").replaceAll("\\[", "[").replaceAll("\\]", "]").trim();
  if (normalized.length === 0) return [{ title: labels.fallbackTitle, content: labels.unavailable }];
  const marker = /\*\*\[([^\]]+)]\*\*/g;
  const matches = [...normalized.matchAll(marker)];
  if (matches.length === 0) return [{ title: labels.fallbackTitle, content: normalized }];
  return matches.map((match, index) => ({
    title: match[1]?.trim() || labels.fallbackTitle,
    content: normalized.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? normalized.length).trim(),
  }));
}

export function summarizeToolDescription(description: string): string {
  const sections = descriptionSections(description);
  const category = sections.find(({ title }) => title !== defaultLabels.fallbackTitle)?.title;
  const purpose = sections.find(({ title, content }) => title.toLocaleLowerCase() === "what it does" && content.length > 0)?.content
    ?? sections.find(({ content }) => content.length > 0)?.content
    ?? defaultLabels.unavailable;
  const plainPurpose = purpose
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const summary = category === undefined ? plainPurpose : `${category} · ${plainPurpose}`;
  return summary.length > 160 ? `${summary.slice(0, 157)}…` : summary;
}
