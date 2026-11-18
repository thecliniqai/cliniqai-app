// Codemod fixture (tests/design/codemod.spec.ts). Input only; the test runs the codemod on a temp copy.
import { cn } from "@/lib/utils";

export function Sample({ on }: { on: boolean }) {
  return (
    <div
      className={cn(
        "hover:bg-[#155CC0]/80 text-[#1769e0] border-[#1769E0]",
        on ? "bg-brand-500 text-brand-600" : "text-gray-400 placeholder:text-gray-400",
        "focus-visible:ring-[#1769E0] ring-2 ring-[#1769e0]/20 !bg-[#EAF2FF] md:hover:text-[#0F5AB8]",
      )}
    >
      <span className={`text-[#123456] ${on ? "bg-[#F7F6F3]" : ""}`}>unmapped and template</span>
      <span className="hover:bg-[#912018]">on purpose</span>
    </div>
  );
}
