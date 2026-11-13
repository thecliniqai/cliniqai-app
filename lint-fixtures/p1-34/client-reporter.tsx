"use client";
import { reportClientError } from "@/lib/log/client";

export function Widget() {
  return <button onClick={() => reportClientError("widget.click.failed", new Error("x"))}>ok</button>;
}
