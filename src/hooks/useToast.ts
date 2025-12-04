import { useState, useCallback } from "react";
import type { ToastData, ToastType } from "../components/ui/Toast";

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", duration = 3000) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type, duration }]);
      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    info: (message: string, duration?: number) => addToast(message, "info", duration),
    success: (message: string, duration?: number) => addToast(message, "success", duration),
    warning: (message: string, duration?: number) => addToast(message, "warning", duration),
    error: (message: string, duration?: number) => addToast(message, "error", duration),
  };

  return { toasts, toast, removeToast };
}
