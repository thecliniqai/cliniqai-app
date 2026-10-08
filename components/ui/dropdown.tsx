"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface DropdownProps {
  trigger: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
  children: React.ReactNode;
}

export function Dropdown({
  trigger,
  align = "right",
  className,
  menuClassName,
  children,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={cn("relative inline-block text-left", className)}>
      <div onClick={() => setIsOpen((prev) => !prev)} className="cursor-pointer">
        {trigger}
      </div>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className={cn(
            "absolute z-50 mt-2 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1.5 shadow-theme-md transition-all",
            align === "right" ? "end-0 origin-top-right" : "start-0 origin-top-left",
            menuClassName
          )}
          onClick={() => setIsOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  children,
  icon,
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      className={cn(
        "w-full px-4 py-2.5 text-start text-sm flex items-center gap-2.5 transition-colors cursor-pointer",
        danger
          ? "text-[#B42318] hover:bg-rose-50"
          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="grow">{children}</span>
    </button>
  );
}
