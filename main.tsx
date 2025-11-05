import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Minimal bootstrap: write something into the DOM so a totally blank page
// immediately signals that the JS didn’t execute at all (e.g. 404 on assets).
const rootEl = document.getElementById("root");
if (rootEl && !rootEl.textContent) {
  rootEl.textContent = "Loading…";
}

function render(App: React.ComponentType) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Dynamic import so that any module-evaluation error in App.tsx is caught
// and surfaced to the page instead of failing silently with a blank screen.
import("./App")
  .then(({ default: App }) => {
    render(App);
  })
  .catch((err) => {
    console.error("Failed to load App module", err);
    if (rootEl) {
      rootEl.innerHTML = "<div style=\"max-width:720px;margin:2rem auto;padding:1rem;border:1px solid #e5e7eb;border-radius:12px;background:#fff;font-family:system-ui,sans-serif\"><h2 style=\"margin:0 0 .5rem;font-size:16px\">App failed to start</h2><pre style=\"white-space:pre-wrap;font-size:12px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.5rem;overflow:auto\"></pre><div style=\"margin-top:.5rem;font-size:12px;color:#6b7280\">Open the console for details. If deploying, ensure build outputs to <code>dist</code>.</div></div>";
      const pre = rootEl.querySelector("pre");
      if (pre) pre.textContent = String(err?.message || err);
    }
  });
