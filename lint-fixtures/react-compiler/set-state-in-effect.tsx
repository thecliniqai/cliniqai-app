// React Compiler fixture (V2-06 06-08): a synchronous setState in an effect body (line 8).
"use client";
import { useEffect, useState } from "react";

export function ResetOnOpen({ isOpen }: { isOpen: boolean }) {
  const [text, setText] = useState("draft");
  useEffect(() => {
    if (isOpen) setText("");
  }, [isOpen]);
  return <p>{text}</p>;
}
