import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { DpdpExportBundle } from "../export";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 40,
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
  },
  headerContainer: {
    borderBottomWidth: 1.5,
    borderBottomColor: "#1769E0",
    borderBottomStyle: "solid",
    paddingBottom: 10,
    marginBottom: 12,
  },
  clinicName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  clinicMeta: {
    fontSize: 8.5,
    color: "#475569",
    marginTop: 2,
  },
  statutoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: "#E2E8F0",
    borderTopStyle: "solid",
  },
  statutoryItem: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#1769E0",
  },
  titleBanner: {
    backgroundColor: "#EAF2FF",
    borderWidth: 1,
    borderColor: "#BFD8FF",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleText: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1769E0",
  },
  subtitleText: {
    fontSize: 7.5,
    color: "#3B82F6",
    marginTop: 1,
  },
  metaText: {
    fontSize: 7.5,
    color: "#475569",
    textAlign: "right",
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
    marginBottom: 6,
    marginTop: 8,
    textTransform: "uppercase",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  gridCol2: {
    width: "50%",
    marginBottom: 4,
  },
  gridCol3: {
    width: "33.33%",
    marginBottom: 4,
  },
  label: {
    fontSize: 7.5,
    color: "#64748B",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  value: {
    fontSize: 8.5,
    color: "#0F172A",
    marginTop: 1,
  },
  badgeSuccess: {
    backgroundColor: "#EAF7F0",
    color: "#18794E",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
  },
  badgeWarning: {
    backgroundColor: "#FFF5E5",
    color: "#9A5B00",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
  },
  alertBox: {
    backgroundColor: "#FDF2F2",
    borderWidth: 0.5,
    borderColor: "#F87171",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 6,
    marginBottom: 6,
  },
  alertText: {
    fontSize: 8,
    color: "#991B1B",
    fontFamily: "Helvetica-Bold",
  },
  table: {
    width: "100%",
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: "#E2E8F0",
    borderStyle: "solid",
    borderRadius: 3,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
    borderBottomStyle: "solid",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#F1F5F9",
    borderBottomStyle: "solid",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  td: {
    fontSize: 8,
    color: "#1E293B",
  },
  card: {
    borderWidth: 0.5,
    borderColor: "#E2E8F0",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 6,
    marginBottom: 6,
    backgroundColor: "#FFFFFF",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F1F5F9",
    borderBottomStyle: "solid",
    paddingBottom: 2,
  },
  cardTitle: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: "#E2E8F0",
    borderTopStyle: "solid",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerNotice: {
    fontSize: 6.5,
    color: "#64748B",
    width: "80%",
    lineHeight: 1.3,
  },
  pageNumber: {
    fontSize: 7.5,
    color: "#94A3B8",
    textAlign: "right",
  },
});

interface MedicalSummaryDocProps {
  payload: DpdpExportBundle;
}

export function MedicalSummaryDocument({ payload }: MedicalSummaryDocProps) {
  const { export_metadata, patient, encounters, prescriptions, documents, consent_records } = payload;
  const address = (patient.address as Record<string, string>) || {};
  const emergency = (patient.emergency_contact as Record<string, string>) || {};
  const allergies = (patient.allergies as string[]) || [];
  const chronicConditions = (patient.chronic_conditions as string[]) || [];
  const regs = export_metadata.statutory_registrations || {};

  const hasStatutory = Boolean(
    regs.clinical_establishment_reg_no ||
    regs.state_medical_council_reg_no ||
    regs.gstin ||
    regs.drug_license_no
  );

  return (
    <Document title={`DPDP Medical Summary - ${patient.full_name}`}>
      <Page size="A4" style={styles.page}>
        {/* Clinic Header */}
        <View style={styles.headerContainer}>
          <Text style={styles.clinicName}>{export_metadata.clinic_name}</Text>
          <Text style={styles.clinicMeta}>
            DPDP Data Fiduciary ID: {export_metadata.tenant_id} • Exported:{" "}
            {new Date(export_metadata.exported_at).toLocaleString("en-IN")}
          </Text>

          {hasStatutory && (
            <View style={styles.statutoryRow}>
              {regs.clinical_establishment_reg_no && (
                <Text style={styles.statutoryItem}>
                  CEA: {regs.clinical_establishment_reg_no}
                </Text>
              )}
              {regs.state_medical_council_reg_no && (
                <Text style={styles.statutoryItem}>
                  SMC: {regs.state_medical_council_reg_no}
                </Text>
              )}
              {regs.gstin && (
                <Text style={styles.statutoryItem}>GSTIN: {regs.gstin}</Text>
              )}
              {regs.drug_license_no && (
                <Text style={styles.statutoryItem}>DL: {regs.drug_license_no}</Text>
              )}
            </View>
          )}
        </View>

        {/* Title Banner */}
        <View style={styles.titleBanner}>
          <View>
            <Text style={styles.titleText}>DPDP RIGHT TO ACCESS: MEDICAL SUMMARY</Text>
            <Text style={styles.subtitleText}>
              Digital Personal Data Protection Act 2023 (Section 11 / 12)
            </Text>
          </View>
          <View>
            <Text style={styles.metaText}>Patient ID: {String(patient.id).slice(0, 8)}...</Text>
            <Text style={styles.metaText}>
              Standard: {export_metadata.standard}
            </Text>
          </View>
        </View>

        {/* 1. Patient Demographics & Baseline Health */}
        <Text style={styles.sectionTitle}>1. Patient Demographics & Baseline Clinical Profile</Text>
        <View style={styles.grid}>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>Full Name</Text>
            <Text style={styles.value}>{String(patient.full_name || "Unknown")}</Text>
          </View>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>Age / Sex</Text>
            <Text style={styles.value}>
              {patient.age ? `${patient.age} yrs` : "Unknown"} /{" "}
              {String(patient.sex || "Not specified").toUpperCase()}
            </Text>
          </View>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>Phone Number</Text>
            <Text style={styles.value}>{String(patient.phone || "Not recorded")}</Text>
          </View>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>ABHA Number</Text>
            <Text style={styles.value}>{String(patient.abha_id || "None linked")}</Text>
          </View>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>Residential Address</Text>
            <Text style={styles.value}>
              {[address.line1, address.city, address.state, address.pincode]
                .filter(Boolean)
                .join(", ") || "None recorded"}
            </Text>
          </View>
          <View style={styles.gridCol3}>
            <Text style={styles.label}>Emergency Contact</Text>
            <Text style={styles.value}>
              {emergency.name
                ? `${emergency.name} (${emergency.relation || "Contact"}) - ${emergency.phone || ""}`
                : "None recorded"}
            </Text>
          </View>
        </View>

        {allergies.length > 0 ? (
          <View style={styles.alertBox}>
            <Text style={styles.alertText}>
              ALERT - RECORDED ALLERGIES: {allergies.join(", ")}
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.label}>Recorded Allergies</Text>
            <Text style={styles.value}>No known drug or environmental allergies recorded.</Text>
          </View>
        )}

        {chronicConditions.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.label}>Chronic Conditions</Text>
            <Text style={styles.value}>{chronicConditions.join(", ")}</Text>
          </View>
        )}

        {/* 2. Chronological Clinical Encounters */}
        <Text style={styles.sectionTitle}>
          2. Clinical Encounters History ({encounters.length} Visits)
        </Text>
        {encounters.length === 0 ? (
          <Text style={{ fontSize: 8, color: "#64748B", marginBottom: 6 }}>
            No clinical visits recorded in this clinic.
          </Text>
        ) : (
          encounters.slice(0, 8).map((enc: any, idx: number) => {
            const vitals = (enc.vitals as Record<string, number>) || {};
            const complaints = Array.isArray(enc.chief_complaints)
              ? enc.chief_complaints.map((c: any) => c.symptom || c).join(", ")
              : "";

            return (
              <View key={idx} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>
                    {new Date(String(enc.scheduled_at || enc.created_at)).toLocaleDateString("en-IN")}{" "}
                    - {String(enc.origin_type || "encounter").toUpperCase()} ({String(enc.status || "completed")})
                  </Text>
                  <Text style={{ fontSize: 7.5, color: "#64748B" }}>
                    Visit ID: {String(enc.id).slice(0, 8)}
                  </Text>
                </View>

                {Boolean(enc.reason_for_visit) ? (
                  <Text style={{ fontSize: 8, color: "#1E293B", marginBottom: 2 }}>
                    Reason: {String(enc.reason_for_visit)}
                  </Text>
                ) : null}

                {Boolean(complaints) ? (
                  <Text style={{ fontSize: 8, color: "#475569", marginBottom: 2 }}>
                    Chief Complaints: {complaints}
                  </Text>
                ) : null}

                {/* Vitals snapshot */}
                {Boolean(vitals.systolic || vitals.pulse || vitals.temperature || vitals.weight) ? (
                  <Text style={{ fontSize: 7.5, color: "#1769E0", marginBottom: 2 }}>
                    Vitals:{" "}
                    {vitals.systolic && vitals.diastolic ? `BP: ${vitals.systolic}/${vitals.diastolic} mmHg ` : ""}
                    {vitals.pulse ? `Pulse: ${vitals.pulse} bpm ` : ""}
                    {vitals.temperature ? `Temp: ${vitals.temperature} °F ` : ""}
                    {vitals.spo2 ? `SpO2: ${vitals.spo2}% ` : ""}
                    {vitals.weight ? `Wt: ${vitals.weight} kg` : ""}
                  </Text>
                ) : null}

                {Boolean(enc.clinical_notes) ? (
                  <Text style={{ fontSize: 7.5, color: "#334155", fontStyle: "italic" }}>
                    Notes: {String(enc.clinical_notes)}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}

        {/* 3. Prescribed Medications Table */}
        <Text style={styles.sectionTitle}>
          3. Prescribed Medications History ({prescriptions.length} Prescriptions)
        </Text>
        {prescriptions.length === 0 ? (
          <Text style={{ fontSize: 8, color: "#64748B", marginBottom: 6 }}>
            No electronic prescriptions recorded.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: "20%" }]}>Date / Rx ID</Text>
              <Text style={[styles.th, { width: "30%" }]}>Medicine / Generic</Text>
              <Text style={[styles.th, { width: "15%" }]}>Dosage</Text>
              <Text style={[styles.th, { width: "15%" }]}>Timing</Text>
              <Text style={[styles.th, { width: "20%" }]}>Duration / Note</Text>
            </View>

            {prescriptions.flatMap((rx) => {
              const items = Array.isArray(rx.prescription_items) ? rx.prescription_items : [];
              const dateStr = new Date(String(rx.created_at)).toLocaleDateString("en-IN");
              const rxCode = String(rx.id).slice(0, 6);

              return items.map((item: any, itemIdx: number) => (
                <View key={`${rx.id}-${itemIdx}`} style={styles.tableRow}>
                  <Text style={[styles.td, { width: "20%" }]}>
                    {dateStr} (#{rxCode})
                  </Text>
                  <Text style={[styles.td, { width: "30%", fontFamily: "Helvetica-Bold" }]}>
                    {item.medicine_name}{" "}
                    {item.generic_name ? `(${item.generic_name})` : ""}
                  </Text>
                  <Text style={[styles.td, { width: "15%" }]}>{item.dosage || "-"}</Text>
                  <Text style={[styles.td, { width: "15%" }]}>{item.timing || "-"}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>
                    {item.duration || "-"}{" "}
                    {item.special_instructions ? `• ${item.special_instructions}` : ""}
                  </Text>
                </View>
              ));
            })}
          </View>
        )}

        {/* 4. Diagnostic Documents & Lab Reports */}
        <Text style={styles.sectionTitle}>
          4. Diagnostic Records & Lab Reports ({documents.length} Records)
        </Text>
        {documents.length === 0 ? (
          <Text style={{ fontSize: 8, color: "#64748B", marginBottom: 6 }}>
            No diagnostic documents uploaded.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: "25%" }]}>Report Date</Text>
              <Text style={[styles.th, { width: "35%" }]}>Document Title</Text>
              <Text style={[styles.th, { width: "20%" }]}>Type</Text>
              <Text style={[styles.th, { width: "20%" }]}>Status</Text>
            </View>
            {documents.slice(0, 10).map((doc: any, dIdx: number) => (
              <View key={dIdx} style={styles.tableRow}>
                <Text style={[styles.td, { width: "25%" }]}>
                  {doc.report_date || new Date(doc.created_at).toLocaleDateString("en-IN")}
                </Text>
                <Text style={[styles.td, { width: "35%" }]}>{doc.title}</Text>
                <Text style={[styles.td, { width: "20%" }]}>{doc.document_type}</Text>
                <Text style={[styles.td, { width: "20%" }]}>
                  {doc.is_abnormal ? "ABNORMAL" : "NORMAL"}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 5. Recorded Consent History */}
        <Text style={styles.sectionTitle}>
          5. DPDP Consent & Processing Audit History ({consent_records.length} Events)
        </Text>
        {consent_records.length === 0 ? (
          <Text style={{ fontSize: 8, color: "#64748B", marginBottom: 6 }}>
            No explicit consent audit entries recorded.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: "25%" }]}>Timestamp</Text>
              <Text style={[styles.th, { width: "30%" }]}>Consent Purpose</Text>
              <Text style={[styles.th, { width: "20%" }]}>Status</Text>
              <Text style={[styles.th, { width: "25%" }]}>Recorded Note</Text>
            </View>
            {consent_records.map((c: any, cIdx: number) => (
              <View key={cIdx} style={styles.tableRow}>
                <Text style={[styles.td, { width: "25%" }]}>
                  {new Date(c.recorded_at).toLocaleString("en-IN")}
                </Text>
                <Text style={[styles.td, { width: "30%" }]}>{c.consent_type}</Text>
                <Text
                  style={[
                    styles.td,
                    {
                      width: "20%",
                      color: c.status === "granted" ? "#18794E" : "#9A5B00",
                      fontFamily: "Helvetica-Bold",
                    },
                  ]}
                >
                  {c.status.toUpperCase()}
                </Text>
                <Text style={[styles.td, { width: "25%" }]}>{c.note || "-"}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Legal Disclaimer Footer on Page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerNotice}>
            Statutory Medical Notice: Under Regulation 1.3.1 of the National Medical Commission (NMC)
            Regulations, medical practitioners must retain clinical records for 3 years. This document
            is generated under the Digital Personal Data Protection Act, 2023.
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
