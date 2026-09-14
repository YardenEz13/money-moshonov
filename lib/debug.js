// Diagnostic toasts: any code can call toast(); DebugToasts in the root layout renders them.
// On by default; the switch in the memory tab is stored per device.
const KEY = "debug-toasts";

export const debugOn = () => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return false; // storage blocked: stay quiet rather than throw
  }
};

export const setDebug = (on) => {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore: the switch just won't persist
  }
};

export function toast(text, level = "info") {
  if (typeof window === "undefined" || !text || !debugOn()) return;
  window.dispatchEvent(new CustomEvent("debug-toast", { detail: { text: String(text), level } }));
}
