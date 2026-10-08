import { getSubscriptionOverview } from "@/features/billing/subscription";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { CreditCard, Receipt, Calendar, CheckCircle2 } from "lucide-react";

export default async function BillingSettingsPage() {
  let overview;
  try {
    overview = await getSubscriptionOverview();
  } catch {
    return (
      <Card className="max-w-3xl border-red-200 bg-red-50/50">
        <CardContent className="p-6">
          <h2 className="text-base font-bold text-red-700">Access Denied</h2>
          <p className="text-xs text-red-600 mt-1">
            Billing details are restricted to Clinic Owners and Administrators.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { subscription, payments } = overview;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Subscription & Billing
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review your active clinic plan, renewal dates, and payment history.
        </p>
      </div>

      {/* Subscription Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 border border-brand-100">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Current Subscription</CardTitle>
              <CardDescription>
                Tier plan and billing lifecycle for this clinic workspace
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="divide-y divide-gray-100">
              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-gray-500">Plan Tier</span>
                <span className="text-sm font-semibold capitalize text-gray-900">
                  {subscription.plan}
                </span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-gray-500">Monthly Amount</span>
                <span className="text-sm font-bold text-gray-900 tabular-nums">
                  ₹{subscription.amount_inr.toLocaleString()} / month
                </span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-gray-500">Status</span>
                <Badge color="success" size="sm" className="uppercase tracking-wider">
                  {subscription.status}
                </Badge>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-gray-500">Next Renewal Date</span>
                <span className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  {new Date(subscription.current_period_end).toLocaleDateString()}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500 py-4 text-center">
              No active subscription record found for this clinic.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 border border-gray-200">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>
                Automated monthly renewal receipts and transactions
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">
              No payments recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {payments.map((p) => (
                <div key={p.id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                  <div>
                    <div className="text-sm font-bold text-gray-900 tabular-nums">
                      ₹{p.amount_inr.toLocaleString()}
                      <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 uppercase">
                        {p.method}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Ref: {p.reference} • {new Date(p.paid_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge color="success" size="sm" startIcon={<CheckCircle2 className="w-3 h-3 text-emerald-600" />}>
                    Paid
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

