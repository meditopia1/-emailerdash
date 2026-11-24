export const setupUpdatedEvent = "marketing-os:setup-updated";
export function invalidateSetup() { if (typeof window !== "undefined") window.dispatchEvent(new Event(setupUpdatedEvent)); }
