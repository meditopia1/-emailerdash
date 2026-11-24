import { toast } from "sonner";

function escape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function focusFormField(field: string, message?: string, announce = false) {
  if (typeof document === "undefined") return;
  const selector = `[name="${escape(field)}"],[data-field="${escape(field)}"]`;
  const input = document.querySelector<HTMLElement>(selector);
  if (!input) {
    if (announce && message) toast.error("Fix this field", { id: `field-error-${field}`, description: message, duration: 6000 });
    return;
  }
  const wrapper = input.closest<HTMLElement>(".os-field") ?? input;
  input.setAttribute("aria-invalid", "true");
  wrapper.classList.add("has-validation-error");
  const clear = () => {
    input.removeAttribute("aria-invalid");
    wrapper.classList.remove("has-validation-error");
    input.removeEventListener("input", clear);
    input.removeEventListener("change", clear);
  };
  input.addEventListener("input", clear);
  input.addEventListener("change", clear);
  input.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  window.setTimeout(() => { if (!input.hasAttribute("disabled")) input.focus({ preventScroll: true }); }, 120);
  if (announce && message) toast.error("Fix this field", { id: `field-error-${field}`, description: message, duration: 6000 });
}

export function firstFieldError(errors: Record<string, string>) {
  const entry = Object.entries(errors).find(([, message]) => Boolean(message));
  return entry ? { field: entry[0], message: entry[1] } : null;
}
