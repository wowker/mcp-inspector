import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title" | "type"> {
  label: string;
  icon: ReactNode;
  title?: string;
  size?: "default" | "compact";
}

export function IconButton({ label, icon, title = label, size = "default", className, ...props }: IconButtonProps) {
  const classes = ["ui-icon-button", className].filter(Boolean).join(" ");
  return <button {...props} type="button" className={classes} data-size={size}
    aria-label={label} title={title}>{icon}</button>;
}
