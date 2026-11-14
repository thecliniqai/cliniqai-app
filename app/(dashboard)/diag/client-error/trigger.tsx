"use client";

/**
 * The diagnostic render error (V2-06 06-04a step 1). After the button is pressed, a child throws while rendering. The
 * message carries synthetic identifier-shaped values that must never reach the screen or the error sink (only the class
 * name and the route pattern may). The name is set explicitly so minification cannot change it.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Synthetic values only (CLAUDE.md): a +91 mobile in the reserved test range and an example.com address. */
export const DIAG_CLIENT_MESSAGE = "Diagnostic client render error (synthetic): contact +919000000000 diag.client@example.com";

class DiagClientRenderError extends Error {
  constructor() {
    super(DIAG_CLIENT_MESSAGE);
    this.name = "DiagClientRenderError";
  }
}

function Thrower(): never {
  throw new DiagClientRenderError();
}

export function DiagClientErrorTrigger() {
  const [armed, setArmed] = useState(false);
  return (
    <>
      <Button type="button" variant="danger" onClick={() => setArmed(true)}>
        Throw a render error
      </Button>
      {armed && <Thrower />}
    </>
  );
}
