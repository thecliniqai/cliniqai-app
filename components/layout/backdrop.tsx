"use client";

import React from "react";
import { useSidebar } from "./sidebar-context";

export function Backdrop() {
  const { isMobileOpen, closeMobileSidebar } = useSidebar();

  if (!isMobileOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-xs lg:hidden transition-opacity duration-200"
      onClick={closeMobileSidebar}
      aria-hidden="true"
    />
  );
}
