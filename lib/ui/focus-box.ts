import type React from "react";

/** A press anywhere on the combobox box (the icon, the padding) focuses its input: the whole box is the target. */
export function focusBoxInput(event: React.MouseEvent<HTMLDivElement>) {
  const input = event.currentTarget.querySelector("input");
  if (input && event.target !== input) {
    event.preventDefault();
    input.focus();
  }
}
