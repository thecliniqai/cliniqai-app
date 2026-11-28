// Semgrep fixture (V2-14 14-02).
export function Note({ html, text }: { html: string; text: string }) {
  const el = document.createElement("div");
  // ruleid: dangerously-set-inner-html
  el.innerHTML = html;
  // ruleid: dangerously-set-inner-html
  const raw = <p dangerouslySetInnerHTML={{ __html: html }} />;
  // ok: dangerously-set-inner-html
  const safe = <p>{text}</p>;
  return [raw, safe];
}
