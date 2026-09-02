import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export function Button({ variant = "secondary", loading = false, loadingLabel, disabled = false,
  className, children, ...props }: ButtonProps) {
  const classes = ["ui-button", className].filter(Boolean).join(" ");
  const accessibleLabel = loading
    ? loadingLabel ?? (typeof children === "string" ? children : undefined)
    : props["aria-label"];
  return <button {...props} type="button" className={classes} data-variant={variant}
    disabled={disabled || loading} aria-busy={loading || undefined}
    aria-label={accessibleLabel}>
    <span className="ui-button__content" aria-hidden={loading || undefined}>{children}</span>
    {loading && <span className="ui-button__loading" aria-hidden="true"><span className="ui-spinner" /></span>}
  </button>;
}
