import { useEffect, useState, type CSSProperties } from "react";
import { Toaster, toast } from "sonner";
import { useTranslation } from "react-i18next";

interface ConfirmToastOptions {
  message: string;
  description?: string;
  actionLabel: string;
  cancelLabel: string;
  onAction: () => void;
  onCancel?: () => void;
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.colorMode === "dark" ? "dark" : "light";
}

export function confirmToast(options: ConfirmToastOptions): string | number {
  return toast.warning(options.message, {
    description: options.description,
    duration: Infinity,
    action: { label: options.actionLabel, onClick: options.onAction },
    cancel: { label: options.cancelLabel, onClick: options.onCancel ?? (() => undefined) },
  });
}

export function AppToaster() {
  const { t } = useTranslation("app");
  const [theme, setTheme] = useState<"light" | "dark">(currentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode"] });
    return () => observer.disconnect();
  }, []);

  return <Toaster
    className="app-toaster"
    style={{
      "--width": "440px",
      top: "50%",
      bottom: "auto",
      left: "50%",
      right: "auto",
      transform: "translate(-50%, -50%)",
    } as CSSProperties}
    theme={theme}
    position="top-center"
    closeButton
    visibleToasts={4}
    gap={10}
    offset={24}
    toastOptions={{
      duration: 2_500,
      className: "app-toast",
      unstyled: true,
      closeButtonAriaLabel: t("toaster.close"),
      classNames: {
        closeButton: "app-toast__close",
        actionButton: "app-toast__action",
        cancelButton: "app-toast__cancel",
      },
    }}
  />;
}
