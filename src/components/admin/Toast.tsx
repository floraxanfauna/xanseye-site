"use client";
import { useCallback, useState } from "react";

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const show = useCallback((text: string, kind: "ok" | "error" = "ok") => { setMsg({ text, kind }); setTimeout(() => setMsg(null), kind === "error" ? 7000 : 3500); }, []);
  const node = msg ? <div className="toast" role={msg.kind === "error" ? "alert" : "status"} style={msg.kind === "error" ? { background: "var(--danger)" } : undefined}>{msg.text}</div> : null;
  return { show, node };
}
