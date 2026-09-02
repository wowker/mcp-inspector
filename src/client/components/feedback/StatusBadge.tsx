import type { HTMLAttributes, ReactNode } from "react";

export type StatusBadgeStatus = "idle" | "pending" | "success" | "warning" | "danger";

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusBadgeStatus;
  children: ReactNode;
}

export function StatusBadge({ status, className, children, ...props }: StatusBadgeProps) {
  const classes = ["ui-status-badge", className].filter(Boolean).join(" ");
  return <span {...props} className={classes} data-status={status}>{children}</span>;
}
