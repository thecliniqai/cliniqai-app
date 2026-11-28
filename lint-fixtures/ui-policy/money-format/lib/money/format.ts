// lib/money is the one place that may build rupee text.
export const formatINR = (paise: number) => "₹" + String(paise / 100);
