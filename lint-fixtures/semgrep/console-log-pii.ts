// Semgrep fixture (V2-14 14-02).
export function send(patient: { name: string }, phone: string, input: { recipientPhone: string }, count: number) {
  // ruleid: console-log-pii
  console.log("sending to", phone);
  // ruleid: console-log-pii
  console.info(`patient ${patient.name}`);
  // ruleid: console-log-pii
  console.error("failed", input.recipientPhone);
  // ok: console-log-pii
  console.log("sent", count);
}
