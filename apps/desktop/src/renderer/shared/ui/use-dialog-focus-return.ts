import { useEffect, useRef, type RefObject } from "react";

/**
 * Restores focus after a dialog really unmounts without treating React
 * StrictMode's setup/cleanup probe as a close-and-reopen interaction.
 */
export function useDialogFocusReturn(dialog: RefObject<HTMLElement | null>) {
  const returnTarget = useRef<HTMLElement | undefined>(undefined);
  const lifecycle = useRef(0);

  useEffect(() => {
    const generation = ++lifecycle.current;
    if (!returnTarget.current?.isConnected) {
      returnTarget.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
    }
    const element = dialog.current;
    const lifecycleRef = lifecycle;

    return () => {
      queueMicrotask(() => {
        if (lifecycleRef.current !== generation) return;
        const target = returnTarget.current;
        const active = document.activeElement;
        if (
          target?.isConnected &&
          (active === document.body || element?.contains(active))
        ) {
          target.focus();
        }
      });
    };
  }, [dialog]);
}
