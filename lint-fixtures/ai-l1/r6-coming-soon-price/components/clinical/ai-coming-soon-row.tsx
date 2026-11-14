// AI-L1 fixture (L1-R6, V2-06 06-01b): the AI-02 "Coming soon" row is an LLM-feature file, so the word AI is allowed
// here, but putting a price next to it still fails: L1-R6 has no exceptions (PO-21). The price is a separate node.
export function AiComingSoonRow() {
  return (
    <div>
      <p>AI features: Coming soon</p>
      <p>₹1,499 + GST</p>
    </div>
  );
}
