import { CaretDown } from "@phosphor-icons/react";
import type { ReactNode, SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

export function Select({ className, children, ...props }: SelectProps) {
  return <span className={["ui-select", className].filter(Boolean).join(" ")}>
    <select {...props}>{children}</select>
    <CaretDown size={16} weight="bold" aria-hidden="true" />
  </span>;
}
