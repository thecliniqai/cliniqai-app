declare const supabase: { auth: { signInWithOtp(input: { email: string }): Promise<unknown> } };

export async function inlineAction() {
  "use server";
  return supabase.auth.signInWithOtp({ email: "synthetic.user@example.test" });
}
