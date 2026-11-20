import { toast } from "sonner";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

// One toast at a time: a new message replaces the current one (and drops any pending Undo).
const TOAST_ID = "career-toast";

/** Show a confirmation toast, or dismiss it with null. With an action (e.g. Undo) it stays up 10 s. */
export function showToast(message: string | null, action?: ToastAction) {
  if (!message) {
    toast.dismiss(TOAST_ID);
    return;
  }
  toast.success(message, {
    id: TOAST_ID,
    duration: action ? 10_000 : 3500,
    action,
  });
}
