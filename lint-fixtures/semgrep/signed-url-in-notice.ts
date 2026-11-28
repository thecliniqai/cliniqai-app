// Semgrep fixture (V2-14 14-02).
export async function remind(storage: Storage, path: string, token: string) {
  const { data } = await storage.createSignedUrl(path, 600);
  // ruleid: signed-url-in-notice
  await sendWhatsAppTemplate({ link: data.signedUrl });
  // ok: signed-url-in-notice
  await sendWhatsAppTemplate({ link: `https://app.example.test/r/${token}` });
}
