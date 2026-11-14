// AI-L1 fixture (L1-R5, V2-06 06-01b): the "AI Assist" label is allowed only in the AI-02 chip files and the LLM
// feature files; written by hand in any other component it fails.
export function PatientHeader() {
  return (
    <header>
      <h1>Patient</h1>
      <span>AI Assist</span>
    </header>
  );
}
