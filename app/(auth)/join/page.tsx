"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite } from "@/features/staff/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Building2 } from "lucide-react";

function JoinClinicContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token") || "";
  const initialEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"otp_request" | "otp_verify">("otp_request");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
    } else {
      setStep("otp_verify");
    }
  };

  const handleVerifyAndJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 1. Verify OTP with Supabase Auth
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });

    if (verifyError) {
      setLoading(false);
      setError(verifyError.message);
      return;
    }

    // 2. Consume the invitation via atomic Server Action
    const result = await acceptInvite(token);
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    // 3. Route to active dashboard
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50/70 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-8 sm:p-10 shadow-theme-sm">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center mb-4 shadow-2xs">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Join Clinic Team
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-xs">
            Accept your invitation to collaborate on ClinicQ
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2"
          >
            <span className="font-semibold">{error}</span>
          </div>
        )}

        {step === "otp_request" ? (
          <form onSubmit={handleRequestOtp} className="space-y-5">
            <Field label="Your Email Address" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="name@example.com"
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              className="w-full h-11 text-sm font-semibold shadow-theme-xs"
              disabled={loading || !token}
            >
              {loading ? "Sending Code..." : "Send Verification Code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyAndJoin} className="space-y-5">
            <Field
              label="6-Digit Verification Code"
              htmlFor="otp"
              required
              help="Check your email for the one-time login code."
            >
              <Input
                id="otp"
                type="text"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="text-center tracking-widest text-lg font-bold"
                required
                placeholder="123456"
                autoFocus
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              className="w-full h-11 text-sm font-semibold shadow-theme-xs"
              disabled={loading}
            >
              {loading ? "Verifying..." : "Verify & Join Clinic"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function JoinClinicPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50/70 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading invitation details...</p>
        </div>
      }
    >
      <JoinClinicContent />
    </Suspense>
  );
}


