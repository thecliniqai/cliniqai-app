// React Compiler fixture (V2-06 06-08): an inline directive that tries to switch a compiler rule off (line 8).
"use client";
import { useEffect, useState } from "react";

export function Quiet({ isOpen }: { isOpen: boolean }) {
  const [text, setText] = useState("draft");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOpen) setText("");
  }, [isOpen]);
  return <p>{text}</p>;
}
