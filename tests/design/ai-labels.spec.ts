/**
 * AI-02 labels (AI_STRATEGY §5.3, PO-21; V2-06 06-01b step 6), rendered with react-dom/server (no jsdom): each chip's
 * copy, glyph and AI tokens; no price anywhere; and the scribe modal's header made of the AI Assist and Preview chips
 * plus the preview note instead of its hand-made sparkle tile. The scribe has no opener in the shipped consult screen
 * (entitlement gating is V2-12), so its open state is rendered here directly.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/ai/actions", () => ({ generateSoapAction: vi.fn() }));

const { AiAssistChip } = await import("@/components/clinical/ai-assist-chip");
const { AI_PREVIEW_NOTE, AiPreviewChip, AiPreviewNote } = await import("@/components/clinical/ai-preview-chip");
const { AiComingSoonRow } = await import("@/components/clinical/ai-coming-soon-row");
const { SmartAssistLabel } = await import("@/components/clinical/smart-assist-label");
const { AiScribeModal } = await import("@/components/consultation/ai-scribe-modal");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const PRICE = /₹|\bRs\b|\bINR\b|\/\s?month|per month|buy|upgrade|subscribe|add to plan/i;

describe("AI-02 labels", () => {
  it('"AI Assist": the Sparkles glyph (hidden from assistive technology) on the AI tokens', () => {
    const html = renderToStaticMarkup(createElement(AiAssistChip));
    expect(text(html)).toBe("AI Assist");
    expect(html).toContain("lucide-sparkles");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    for (const cls of ["bg-ai-bg", "text-ai-fg", "border-ai-border", "text-ai-glyph"]) expect(html).toContain(cls);
  });

  it('"Preview" chip and the note that AI is not sold', () => {
    expect(text(renderToStaticMarkup(createElement(AiPreviewChip)))).toBe("Preview");
    expect(renderToStaticMarkup(createElement(AiPreviewChip))).toContain("bg-preview-bg");
    expect(text(renderToStaticMarkup(createElement(AiPreviewNote)))).toBe(
      "AI features are in preview and not yet offered as a paid product.",
    );
    expect(AI_PREVIEW_NOTE).not.toMatch(PRICE);
  });

  it('"AI features: Coming soon" is muted text with no price and no button', () => {
    const html = renderToStaticMarkup(createElement(AiComingSoonRow));
    expect(text(html)).toBe("AI features: Coming soon");
    expect(html).toContain("text-fg-muted");
    expect(html).not.toMatch(/<button|<a\b/);
    expect(text(html)).not.toMatch(PRICE);
  });

  it('"Smart Assist" uses the Zap glyph and never the word AI or Sparkles', () => {
    const html = renderToStaticMarkup(createElement(SmartAssistLabel));
    expect(text(html)).toBe("Smart Assist");
    expect(html).toContain("lucide-zap");
    expect(html).not.toContain("lucide-sparkles");
    expect(text(html)).not.toMatch(/\bAI\b/);
    expect(html).toContain("text-smart-fg");
  });

  it("the scribe modal's header shows AI Assist, Preview and the note (no hand-made sparkle tile)", () => {
    const html = renderToStaticMarkup(createElement(AiScribeModal, { isOpen: true, onClose: () => {}, onAccept: () => {} }));
    const header = html.slice(0, html.indexOf("scribe-shorthand"));
    expect(text(header)).toContain("Clinical Scribe — Shorthand AI Assist Preview");
    expect(text(header)).toContain(AI_PREVIEW_NOTE);
    expect(header).not.toContain("bg-indigo-50");
    expect(text(html)).not.toMatch(/₹|\/\s?month|per month|upgrade|subscribe/i);
  });
});
