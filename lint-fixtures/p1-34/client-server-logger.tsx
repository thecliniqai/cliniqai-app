"use client";
import { log } from "@/lib/log";
import { clientErrorMessage } from "@/lib/errors/client-message";

export function Widget() {
  return <button onClick={() => log.info({ event: "widget.click.done" })}>{String(clientErrorMessage)}</button>;
}
