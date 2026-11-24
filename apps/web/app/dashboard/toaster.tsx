"use client";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function GlobalToaster() {
  const [mobile, setMobile] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => setMobile(media.matches); update();
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let previous = false;
    const update = () => { const next = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')); if (next !== previous) { previous = next; setModalOpen(next); } };
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true }); update();
    return () => observer.disconnect();
  }, []);
  // Keep modal footers and close buttons clear. Never pass clicks through a toast to a hidden action.
  return <Toaster position={modalOpen ? mobile ? "top-center" : "top-left" : mobile ? "bottom-center" : "bottom-right"} closeButton duration={3000} visibleToasts={3} offset={24} mobileOffset={modalOpen ? { top: 112, left: 16, right: 16, bottom: 16 } : 16} containerAriaLabel="Dashboard notifications" toastOptions={{ className: "os-toast", descriptionClassName: "os-toast-description", closeButtonAriaLabel: "Dismiss notification", style: { background: "var(--os-surface, white)", color: "var(--os-text, #202827)", border: "1px solid var(--os-line, #e5e8e8)", fontFamily: "inherit" }, actionButtonStyle: { background: "var(--os-button, #202827)", color: "var(--os-button-text, white)" } }} />;
}
