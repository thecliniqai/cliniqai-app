// Semgrep fixture (V2-14 14-02).
// ruleid: webhook-auth-return-true
function verifyProviderSignature(body: string, signature: string) {
  void body;
  void signature;
  return true;
}

// ruleid: webhook-auth-return-true
const verifyWebhookSecret = async (header: string | null) => {
  void header;
  return true;
};

// ok: webhook-auth-return-true
function verifyMsg91Signature(body: string, signature: string, expected: string) {
  if (!signature) return false;
  return timingSafeEqual(body + signature, expected);
}

// ok: webhook-auth-return-true
function isOpen(x: number) {
  return true || x;
}
