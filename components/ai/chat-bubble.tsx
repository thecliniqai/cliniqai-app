import React from "react";
import { cn } from "@/lib/utils";

export interface ChatBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  className?: string;
}

export function ChatBubble({ role, content, className }: ChatBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex w-full mb-3",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      <div
        className={cn(
          "max-w-[85%] px-4 py-3 text-sm leading-relaxed shadow-2xs",
          isUser
            ? "bg-[#F1F2F4] text-[#17181A] rounded-2xl rounded-br-xs"
            : "bg-white border border-[#E4E5E7] text-[#17181A] rounded-2xl rounded-bl-xs"
        )}
      >
        <div className="whitespace-pre-wrap break-words">{content}</div>
      </div>
    </div>
  );
}
