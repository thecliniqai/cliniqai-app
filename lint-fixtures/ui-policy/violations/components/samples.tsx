// UI policy fixture: each line marked below is one finding. A comment with bg-[#1769e0] or min-h-screen is not one.
import Link from "next/link";

export function Samples() {
  return (
    <div className="bg-[#1769E0] p-2">
      <p className="text-[11px]">small</p>
      <p className="text-gray-500 hover:text-fg">palette</p>
      <span className="bg-v1-blue-500">raw token outside the primitives</span>
      <main className="md:min-h-app">tall, the dvh utility (not a finding)</main>
      <Link href="/patients">
        <button type="button">Open</button>
      </Link>
      <button type="button" onClick={() => window.confirm("Sure?")}>
        Ask
      </button>
    </div>
  );
}
