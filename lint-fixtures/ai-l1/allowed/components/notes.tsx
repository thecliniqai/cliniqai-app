// AI-L1 fixture (allowed): comments, identifiers and words that merely contain the letters are not UI copy.
// AI scribe slot lives elsewhere.
const AI = "MAIL";

export function NotesPanel() {
  return (
    <section data-kind={AI}>
      {/* AI Clinical Scribe Modal */}
      <p>Smart Assist suggestions. Upgrade your plan for ₹499/month.</p>
    </section>
  );
}
