// React Compiler fixture (V2-06 06-08): an effect reads a function declared below it (line 9).
"use client";
import { useEffect, useState } from "react";

export function Loader({ id }: { id: string }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    load(id);
  }, [id]);

  const load = async (key: string) => {
    const res = await fetch(`/api/${key}`);
    setValue(await res.text());
  };
  return <p>{value}</p>;
}
