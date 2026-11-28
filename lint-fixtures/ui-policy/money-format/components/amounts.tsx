// UI policy fixture (money-format, V2-10 10-01): lines 6-10 and 12 are findings; the rest are not. "₹" + x in a comment is not one.
export function Amounts({ amount, fee, at, when }: { amount: number; fee: number; at: string; when: Date }) {
  const label = "Consultation fee (₹)";
  return (
    <div>
      <p>{amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
      <p>{"₹" + amount}</p>
      <p>{`Collect ₹${amount} & Checkout`}</p>
      <p>₹{fee}</p>
      <p>(₹{fee})</p>
      <p>{new Date(at).toLocaleString("en-IN")}</p>
      <p>{amount.toLocaleString("en-in")}</p>
      <p>{when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" })}</p>
      <p>{label}</p>
      <p>{"Price cannot be more than ₹10,00,000"}</p>
      <p>₹ heading only</p>
      <p>{"₹" + "500"}</p>
      <p>{`${amount} total`}</p>
    </div>
  );
}
