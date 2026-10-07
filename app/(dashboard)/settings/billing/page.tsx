import { getSubscriptionOverview } from "@/features/billing/subscription";

export default async function BillingSettingsPage() {
  let overview;
  try {
    overview = await getSubscriptionOverview();
  } catch {
    return (
      <div className="p-6 bg-white border border-[#E5E4E0] rounded-lg">
        <h2 className="text-lg font-semibold text-red-600">Access Denied</h2>
        <p className="text-sm text-[#666] mt-1">
          Billing details are restricted to Clinic Owners and Administrators.
        </p>
      </div>
    );
  }

  const { subscription, payments } = overview;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">
          Subscription & Billing
        </h1>
        <p className="text-sm text-[#666] mt-1">
          Review your active clinic plan, renewal dates, and payment history.
        </p>
      </div>

      {/* Subscription Card */}
      <section className="bg-white border border-[#E5E4E0] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[#1A1A1A] mb-4">Current Subscription</h2>
        {subscription ? (
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[#F0EFEA]">
              <span className="text-sm text-[#666]">Plan</span>
              <span className="text-sm font-semibold capitalize text-[#1A1A1A]">
                {subscription.plan}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#F0EFEA]">
              <span className="text-sm text-[#666]">Monthly Amount</span>
              <span className="text-sm font-semibold text-[#1A1A1A]">
                ₹{subscription.amount_inr.toLocaleString()} / month
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#F0EFEA]">
              <span className="text-sm text-[#666]">Status</span>
              <span className="text-xs uppercase font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                {subscription.status}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[#666]">Next Renewal Date</span>
              <span className="text-sm font-medium text-[#1A1A1A]">
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[#777]">
            No active subscription record found for this clinic.
          </div>
        )}
      </section>

      {/* Payment History */}
      <section className="bg-white border border-[#E5E4E0] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[#1A1A1A] mb-4">Payment History</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-[#777]">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-[#E5E4E0]">
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[#1A1A1A]">
                    ₹{p.amount_inr.toLocaleString()} — {p.method.toUpperCase()}
                  </div>
                  <div className="text-xs text-[#777]">
                    Ref: {p.reference} • {new Date(p.paid_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                  Paid
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
