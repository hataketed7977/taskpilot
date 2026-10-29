import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function BoardModal({
  title,
  children,
  pending,
  danger = false,
  sheet = false,
  titleContent,
  titleEditor,
  titleFeedback,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  pending: boolean;
  danger?: boolean;
  sheet?: boolean;
  titleContent?: ReactNode;
  titleEditor?: ReactNode;
  titleFeedback?: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const titleElement = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const element = dialog.current;
    const initial = sheet
      ? titleElement.current
      : element?.querySelector<HTMLElement>(
          "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ) ?? element?.querySelector<HTMLElement>("button:not([disabled])");
    initial?.focus();
    return () => {
      const active = document.activeElement;
      if (
        returnTo?.isConnected &&
        (active === document.body || element?.contains(active))
      )
        returnTo.focus();
    };
  }, [sheet]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ),
      ];
      const first = items[0];
      const last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === titleElement.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, pending]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        ref={dialog}
        className={`project-dialog board-dialog${danger ? " project-dialog--danger" : ""}${sheet ? " work-item-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div className="board-dialog__heading">
            <h2
              ref={titleElement}
              id={titleId}
              className={titleEditor ? "visually-hidden" : undefined}
              tabIndex={sheet ? -1 : undefined}
            >
              {titleContent ?? title}
            </h2>
            {titleEditor}
            {titleFeedback}
          </div>
          <button
            type="button"
            className="icon-action"
            disabled={pending}
            aria-label={t("project.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
        {footer}
      </section>
    </div>
  );
}
