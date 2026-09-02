import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

type FormControl = ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>;

export interface FormFieldProps {
  label: ReactNode;
  htmlFor: string;
  children: FormControl;
  required?: boolean;
  description?: ReactNode;
  constraint?: ReactNode;
  error?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function FormField({
  label, htmlFor, children, required = false, description, constraint, error, actions, className,
}: FormFieldProps) {
  const descriptionId = useId();
  const constraintId = useId();
  const errorId = useId();
  const describedBy = [children.props["aria-describedby"], description !== undefined ? descriptionId : undefined,
    constraint !== undefined ? constraintId : undefined, error !== undefined ? errorId : undefined].filter(Boolean).join(" ");

  return <div className={["ui-form-field", className].filter(Boolean).join(" ")}>
    <div className="ui-form-field__heading"><span className="ui-form-field__label"><label htmlFor={htmlFor}>{label}</label>{required && <span className="ui-form-field__required" aria-hidden="true">*</span>}</span>{actions}</div>
    {description !== undefined && <p id={descriptionId} className="ui-form-field__description">{description}</p>}
    {constraint !== undefined && <p id={constraintId} className="ui-form-field__constraint">{constraint}</p>}
    {cloneElement(children, { "aria-describedby": describedBy || undefined, "aria-invalid": error !== undefined || children.props["aria-invalid"] })}
    {error !== undefined && <p id={errorId} className="ui-form-field__error" role="alert">{error}</p>}
  </div>;
}
