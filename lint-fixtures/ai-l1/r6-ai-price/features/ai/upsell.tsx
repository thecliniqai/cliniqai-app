// AI-L1 fixture (L1-R6): "AI" next to a price or purchase action fails even inside features/ai/, where the word AI
// itself is allowed (PO-21: no exceptions). The two strings are separate JSX nodes on purpose.
export function NotesUpsell() {
  return (
    <div>
      <p>AI clinical notes</p>
      <p>Upgrade for ₹499/month</p>
    </div>
  );
}
