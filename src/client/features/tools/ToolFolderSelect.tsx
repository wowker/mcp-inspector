import { FolderSimplePlus } from "@phosphor-icons/react";
import type { ToolFolderSummary } from "../../api/api-client.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";

interface ToolFolderSelectProps {
  ariaLabel: string;
  disabled: boolean;
  folderId: string | null;
  folders: readonly ToolFolderSummary[];
  title: string;
  unfiledLabel: string;
  searchPlaceholder: string;
  emptyMessage: string;
  onChange: (folderId: string | null) => void;
}

const unfiledValue = "__mcp_inspector_unfiled__";

export function ToolFolderSelect({
  ariaLabel, disabled, folderId, folders, title, unfiledLabel, searchPlaceholder, emptyMessage, onChange,
}: ToolFolderSelectProps) {
  return <SearchableSelect className="tool-folder-select" ariaLabel={ariaLabel} disabled={disabled}
    title={title} value={folderId ?? unfiledValue}
    options={[{ value: unfiledValue, label: unfiledLabel }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
    onChange={(nextFolderId) => onChange(nextFolderId === unfiledValue || nextFolderId === null ? null : nextFolderId)}
    placeholder={unfiledLabel} searchPlaceholder={searchPlaceholder} emptyMessage={emptyMessage}
    triggerContent={<FolderSimplePlus size={16} weight="bold" aria-hidden="true" />} />;
}
