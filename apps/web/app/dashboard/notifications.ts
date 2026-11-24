"use client";
import { toast } from "sonner";
import { ApiRequestError } from "./types";
import { invalidateSetup } from "../help/events";
import { firstFieldError, focusFormField } from "./field-errors";

const failures = new Map<string, string>();
export const notifications = {
  loading(id: string) {
    failures.delete(id);
    toast.loading("Refreshing data", { id, description: "Checking for the latest updates.", closeButton: true, action: undefined, cancel: undefined });
  },
  loaded(id: string, page: string, restored = false, notify = true) {
    failures.delete(id);
    if (notify || restored) toast.success(restored ? "Connection restored" : "Data loaded", { id, description: restored ? "Your dashboard is connected and up to date." : `Your ${page} data is up to date.`, duration: 3000, action: undefined, cancel: undefined });
  },
  failed(id: string, page: string, detail: string, retry: () => void) {
    if (failures.get(id) === detail) return;
    failures.set(id, detail);
    toast.error("Couldn't load data", { id, description: `Unable to retrieve ${page} data. Try again.`, duration: 6000, action: { label: "Retry", onClick: event => { event.preventDefault(); retry(); } } });
  },
  cancel(id: string) { toast.dismiss(id); },
};

/** Only wrap the actual server mutation, never its later UI refresh. */
export async function notifySave<T>(id: string, operation: () => Promise<T>): Promise<T> {
  toast.loading("Saving changes", { id, description: "Waiting for server confirmation.", closeButton: true });
  try {
    const result = await operation();
    invalidateSetup();
    toast.success("Changes saved", { id, description: "Your updates have been saved successfully.", duration: 3000 });
    return result;
  } catch (error) {
    const unknown = error instanceof ApiRequestError && error.uncertain;
    const fieldError = error instanceof ApiRequestError ? firstFieldError(error.fieldErrors) : null;
    if (fieldError) focusFormField(fieldError.field, fieldError.message);
    toast.error(fieldError ? "Fix this field" : unknown ? "Save not confirmed" : "Couldn't save changes", { id, description: fieldError ? fieldError.message : unknown ? "The server did not confirm this change. Check the saved data before trying again; no automatic retry was made." : "Your changes weren't saved. Please try again.", duration: unknown ? Infinity : 6000 });
    throw error;
  }
}
