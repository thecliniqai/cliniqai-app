import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface ReceiptPdfPayload {
  tenant_id: string;
  invoice_id: string;
  invoice_number: string;
  receipt_number?: string;
  date: string;

  clinic: {
    name: string;
    address?: string | null;
    phone?: string | null;
    registration_number?: string | null;
    gstin?: string | null;
    logo_url?: string | null;
  };

  patient: {
    full_name: string;
    age?: number | null;
    sex?: string | null;
    phone?: string | null;
    uhid?: string | null;
    address?: string | null;
  };

  doctor?: {
    name: string;
    qualifications?: string | null;
    registration_no?: string | null;
  } | null;

  items: Array<{
    id?: string;
    description: string;
    item_type: string;
    unit_price: number;
    quantity: number;
    total_price: number;
  }>;

  subtotal: number;
  discount: number;
  tax: number;
  total_amount: number;

  payments: Array<{
    id?: string;
    amount: number;
    payment_method: "cash" | "upi" | "card";
    reference_number?: string | null;
    recorded_at: string;
  }>;

  total_paid: number;
  balance_due: number;
  status: "draft" | "issued" | "paid" | "cancelled";
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#1769E0",
    paddingBottom: 12,
    marginBottom: 12,
  },
  clinicInfo: {
    maxWidth: 340,
  },
  clinicName: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    marginBottom: 3,
  },
  clinicSubText: {
    fontSize: 8.5,
    color: "#475569",
    marginBottom: 2,
    lineHeight: 1.3,
  },
  receiptBadgeContainer: {
    alignItems: "flex-end",
  },
  receiptTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1769E0",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  statusPaid: {
    backgroundColor: "#ECFDF5",
    color: "#059669",
  },
  statusIssued: {
    backgroundColor: "#FEF3C7",
    color: "#D97706",
  },
  patientBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 6,
    padding: 10,
    marginBottom: 14,
  },
  metaColumn: {
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    fontSize: 8,
    color: "#64748B",
    width: 70,
  },
  metaValue: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#1E293B",
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  table: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 14,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderBottomWidth: 1,
    borderBottomColor: "#CBD5E1",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  colSl: {
    width: "8%",
  },
  colDesc: {
    width: "52%",
  },
  colQty: {
    width: "12%",
    textAlign: "right",
  },
  colPrice: {
    width: "14%",
    textAlign: "right",
  },
  colTotal: {
    width: "14%",
    textAlign: "right",
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  tableRowText: {
    fontSize: 8.5,
    color: "#1E293B",
  },
  totalsContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 14,
  },
  totalsBox: {
    width: 220,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 4,
    padding: 8,
    backgroundColor: "#FAFAFA",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#CBD5E1",
    paddingTop: 5,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 8.5,
    color: "#64748B",
  },
  totalValue: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#1E293B",
  },
  grandTotalLabel: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
  },
  grandTotalValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1769E0",
  },
  paymentsBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 4,
    padding: 8,
    marginBottom: 14,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  paymentText: {
    fontSize: 8,
    color: "#334155",
  },
  paymentAmount: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#059669",
  },
  footer: {
    marginTop: "auto",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerNote: {
    fontSize: 7.5,
    color: "#94A3B8",
    maxWidth: 320,
  },
  signatureBox: {
    alignItems: "center",
    width: 140,
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: "#475569",
    width: "100%",
    marginBottom: 4,
  },
  signatureText: {
    fontSize: 8,
    color: "#475569",
    textAlign: "center",
  },
});

export const ReceiptDocument: React.FC<{ payload: ReceiptPdfPayload }> = ({ payload }) => {
  const isPaid = payload.status === "paid" || payload.balance_due <= 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Clinic Header & Receipt Meta */}
        <View style={styles.headerContainer}>
          <View style={styles.clinicInfo}>
            <Text style={styles.clinicName}>{payload.clinic.name}</Text>
            {payload.clinic.address && (
              <Text style={styles.clinicSubText}>{payload.clinic.address}</Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {payload.clinic.phone && (
                <Text style={styles.clinicSubText}>Tel: {payload.clinic.phone}</Text>
              )}
              {payload.clinic.registration_number && (
                <Text style={styles.clinicSubText}>Reg: {payload.clinic.registration_number}</Text>
              )}
              {payload.clinic.gstin && (
                <Text style={styles.clinicSubText}>GSTIN: {payload.clinic.gstin}</Text>
              )}
            </View>
          </View>

          <View style={styles.receiptBadgeContainer}>
            <Text style={styles.receiptTitle}>Payment Receipt</Text>
            <Text style={[styles.statusBadge, isPaid ? styles.statusPaid : styles.statusIssued]}>
              {isPaid ? "PAID" : "BALANCE DUE"}
            </Text>
            <View style={{ marginTop: 6, alignItems: "flex-end" }}>
              <Text style={{ fontSize: 8, color: "#64748B" }}>
                Receipt: {payload.receipt_number || payload.invoice_number}
              </Text>
              <Text style={{ fontSize: 8, color: "#64748B" }}>
                Date: {payload.date.split("T")[0]}
              </Text>
            </View>
          </View>
        </View>

        {/* Patient & Doctor Demographics */}
        <View style={styles.patientBox}>
          <View style={styles.metaColumn}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Patient Name:</Text>
              <Text style={styles.metaValue}>{payload.patient.full_name}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Age / Sex:</Text>
              <Text style={styles.metaValue}>
                {[payload.patient.age ? `${payload.patient.age} Y` : null, payload.patient.sex]
                  .filter(Boolean)
                  .join(" / ") || "—"}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Phone:</Text>
              <Text style={styles.metaValue}>{payload.patient.phone || "—"}</Text>
            </View>
          </View>

          <View style={styles.metaColumn}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice No:</Text>
              <Text style={styles.metaValue}>{payload.invoice_number}</Text>
            </View>
            {payload.patient.uhid && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>UHID:</Text>
                <Text style={styles.metaValue}>{payload.patient.uhid}</Text>
              </View>
            )}
            {payload.doctor?.name && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Doctor:</Text>
                <Text style={styles.metaValue}>
                  Dr. {payload.doctor.name}{" "}
                  {payload.doctor.qualifications ? `(${payload.doctor.qualifications})` : ""}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Itemized Charges Table */}
        <Text style={styles.sectionTitle}>Itemized Billing Particulars</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colSl, styles.tableHeaderText]}>#</Text>
            <Text style={[styles.colDesc, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colPrice, styles.tableHeaderText]}>Rate (₹)</Text>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colTotal, styles.tableHeaderText]}>Total (₹)</Text>
          </View>

          {payload.items.map((item, index) => (
            <View key={item.id || index} style={styles.tableRow}>
              <Text style={[styles.colSl, styles.tableRowText]}>{index + 1}</Text>
              <Text style={[styles.colDesc, styles.tableRowText]}>
                {item.description}{" "}
                <Text style={{ fontSize: 7, color: "#64748B" }}>
                  ({item.item_type.toUpperCase()})
                </Text>
              </Text>
              <Text style={[styles.colPrice, styles.tableRowText]}>
                {Number(item.unit_price).toFixed(2)}
              </Text>
              <Text style={[styles.colQty, styles.tableRowText]}>{item.quantity}</Text>
              <Text style={[styles.colTotal, styles.tableRowText]}>
                {Number(item.total_price).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals Summary */}
        <View style={styles.totalsContainer}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal:</Text>
              <Text style={styles.totalValue}>₹{Number(payload.subtotal).toFixed(2)}</Text>
            </View>
            {payload.discount > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount:</Text>
                <Text style={[styles.totalValue, { color: "#E11D48" }]}>
                  -₹{Number(payload.discount).toFixed(2)}
                </Text>
              </View>
            )}
            {payload.tax > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax / GST:</Text>
                <Text style={styles.totalValue}>+₹{Number(payload.tax).toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total Amount:</Text>
              <Text style={styles.grandTotalValue}>₹{Number(payload.total_amount).toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Paid:</Text>
              <Text style={[styles.totalValue, { color: "#059669" }]}>
                ₹{Number(payload.total_paid).toFixed(2)}
              </Text>
            </View>
            {payload.balance_due > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: "#D97706", fontFamily: "Helvetica-Bold" }]}>
                  Balance Due:
                </Text>
                <Text style={[styles.totalValue, { color: "#D97706" }]}>
                  ₹{Number(payload.balance_due).toFixed(2)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Payment History / Transactions */}
        {payload.payments.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Payment Details</Text>
            <View style={styles.paymentsBox}>
              {payload.payments.map((p, idx) => (
                <View key={p.id || idx} style={styles.paymentRow}>
                  <Text style={styles.paymentText}>
                    <Text style={{ fontFamily: "Helvetica-Bold", textTransform: "uppercase" }}>
                      {p.payment_method}
                    </Text>{" "}
                    {p.reference_number ? `(Ref: ${p.reference_number})` : ""} —{" "}
                    {new Date(p.recorded_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  <Text style={styles.paymentAmount}>₹{Number(p.amount).toFixed(2)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer & Signature */}
        <View style={styles.footer}>
          <Text style={styles.footerNote}>
            Thank you for choosing {payload.clinic.name}. This is a computer-generated tax/billing
            receipt and requires no physical seal when electronically certified.
          </Text>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureText}>Authorized Signatory</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
