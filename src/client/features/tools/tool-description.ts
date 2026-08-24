export interface DescriptionSection {
  title: string;
  content: string;
}

export function descriptionSections(description: string | undefined): DescriptionSection[] {
  const normalized = (description ?? "").replaceAll("\\[", "[").replaceAll("\\]", "]").trim();
  if (normalized.length === 0) return [{ title: "说明", content: "暂无描述" }];
  const marker = /\*\*\[([^\]]+)]\*\*/g;
  const matches = [...normalized.matchAll(marker)];
  if (matches.length === 0) return [{ title: "说明", content: normalized }];
  return matches.map((match, index) => ({
    title: match[1]?.trim() || "说明",
    content: normalized.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? normalized.length).trim(),
  }));
}

export function summarizeToolDescription(description: string): string {
  const sections = descriptionSections(description);
  const category = sections.find(({ title }) => title !== "说明")?.title;
  const purpose = sections.find(({ title, content }) => title.toLocaleLowerCase() === "what it does" && content.length > 0)?.content
    ?? sections.find(({ content }) => content.length > 0)?.content
    ?? "暂无描述";
  const plainPurpose = purpose
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const summary = category === undefined ? plainPurpose : `${category} · ${plainPurpose}`;
  return summary.length > 160 ? `${summary.slice(0, 157)}…` : summary;
}
