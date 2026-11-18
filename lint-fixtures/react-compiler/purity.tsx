// React Compiler fixture (V2-06 06-08): a clock read during render (line 4).
"use client";
export function Age({ since }: { since: number }) {
  const days = Math.floor((Date.now() - since) / 86_400_000);
  return <p>{days}</p>;
}
