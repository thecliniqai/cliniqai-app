"use client";

import React from "react";
import { Lock } from "lucide-react";

export function SocialAuthButtons() {
  return (
    <div className="space-y-3">
      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-3 text-gray-400 font-medium tracking-wider">
            Or continue with
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Google SSO Button (Disabled / Locked) */}
        <button
          type="button"
          disabled
          aria-label="Sign in with Google (Coming Soon in Phase 3)"
          className="relative inline-flex items-center justify-center gap-2.5 w-full h-11 px-4 text-xs font-medium rounded-xl border border-gray-200 bg-gray-50/70 text-gray-400 cursor-not-allowed transition-all opacity-80 group select-none"
        >
          {/* Authentic Google Multi-Color SVG Logo */}
          <svg
            className="w-4 h-4 shrink-0 opacity-75 grayscale group-hover:grayscale-0 transition-all"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              fill="#4285F4"
            />
            <path
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24Z"
              fill="#34A853"
            />
            <path
              d="M5.28 14.27a7.17 7.17 0 0 1 0-4.54V6.58H1.25a11.96 11.96 0 0 0 0 10.84l4.03-3.15Z"
              fill="#FBBC05"
            />
            <path
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.18 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
              fill="#EA4335"
            />
          </svg>
          <span className="font-semibold text-gray-500">Google</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-200/60 px-1.5 py-0.5 rounded">
            <Lock className="w-2.5 h-2.5" />
            <span>Soon</span>
          </span>
        </button>

        {/* Microsoft SSO Button (Disabled / Locked) */}
        <button
          type="button"
          disabled
          aria-label="Sign in with Microsoft (Coming Soon in Phase 3)"
          className="relative inline-flex items-center justify-center gap-2.5 w-full h-11 px-4 text-xs font-medium rounded-xl border border-gray-200 bg-gray-50/70 text-gray-400 cursor-not-allowed transition-all opacity-80 group select-none"
        >
          {/* Authentic Microsoft 4-Color Squares SVG Logo */}
          <svg
            className="w-4 h-4 shrink-0 opacity-75 grayscale group-hover:grayscale-0 transition-all"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M1 1h10v10H1V1Z" fill="#F25022" />
            <path d="M13 1h10v10H13V1Z" fill="#7FBA00" />
            <path d="M1 13h10v10H1V13Z" fill="#00A4EF" />
            <path d="M13 13h10v10H13V13Z" fill="#FFB900" />
          </svg>
          <span className="font-semibold text-gray-500">Microsoft</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-200/60 px-1.5 py-0.5 rounded">
            <Lock className="w-2.5 h-2.5" />
            <span>Soon</span>
          </span>
        </button>
      </div>

      <p className="text-center text-[11px] text-gray-400">
        Enterprise SSO via Google Workspace &amp; Microsoft 365 is scheduled for Phase 3.
      </p>
    </div>
  );
}
