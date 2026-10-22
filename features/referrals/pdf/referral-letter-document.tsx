import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { LetterheadMode, ReferralUrgency } from "@/lib/db/types";

export interface ReferralPdfPayload {
  referral_id: string;
  tenant_id: string;
  letterhead_mode: LetterheadMode;
  urgency: ReferralUrgency;
  sent_at: string;

  clinic: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    registration_number?: string | null;
  };

  referring_doctor: {
    name: string;
    qualifications?: string | null;
    medical_council_reg_no?: string | null;
  };

  recipient: {
    name: string;
    facility?: string | null;
    specialty?: string | null;
    contact?: string | null;
  };

  patient: {
    full_name: string;
    age?: number | null;
    sex?: string | null;
    phone?: string | null;
    uhid?: string | null;
    address?: string | null;
  };

  clinical: {
    reason_for_referral: string;
    provisional_diagnosis?: string | null;
    clinical_summary?: string | null;
    vitals?: {
      systolic?: number | null;
      diastolic?: number | null;
      pulse?: number | null;
      temperature?: number | null;
      spo2?: number | null;
      weight?: number | null;
      height?: number | null;
    } | null;
    medications?: {
      medicine_name: string;
      dosage: string;
      timing?: string | null;
      duration: string;
      special_instructions?: string | null;
    }[];
    investigations_advised?: string[];
  };
}

const styles = StyleSheet.create({
  pageBlankPaper: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
  },
  pagePreprinted: {
    paddingTop: 110, // ~39mm letterhead pad margin
    paddingBottom: 60,
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
  },
  continuationHeader: {
    position: "absolute",
    top: 14,
    left: 36,
    right: 36,
    borderBottomWidth: 0.5,
    borderColor: "#CBD5E1",
    paddingBottom: 4,
  },
  continuationText: {
    fontSize: 7.5,
    color: "#64748B",
    fontFamily: "Helvetica",
  },
  // Header section
  headerContainer: {
    borderBottomWidth: 1.5,
    borderColor: "#0F172A",
    paddingBottom: 8,
    marginBottom: 10,
  },
  clinicName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#0F172A",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  clinicMeta: {
    fontSize: 8,
    color: "#64748B",
    marginBottom: 2,
  },
  doctorContainer: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  doctorName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: "#1E293B",
  },
  doctorMeta: {
    fontSize: 8,
    color: "#64748B",
  },
  // Referral title bar
  titleBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 4,
    padding: 6,
    marginBottom: 10,
  },
  titleText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#0F172A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  urgencyBadgeRoutine: {
    backgroundColor: "#F1F5F9",
    borderWidth: 0.5,
    borderColor: "#94A3B8",
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  urgencyBadgePriority: {
    backgroundColor: "#FFFBEB",
    borderWidth: 0.5,
    borderColor: "#F59E0B",
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#B45309",
    textTransform: "uppercase",
  },
  urgencyBadgeUrgent: {
    backgroundColor: "#FEF2F2",
    borderWidth: 0.5,
    borderColor: "#EF4444",
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#B91C1C",
    textTransform: "uppercase",
  },
  // Recipient block
  recipientBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  recipientLabel: {
    fontSize: 7.5,
    color: "#64748B",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  recipientName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#1E293B",
  },
  recipientMeta: {
    fontSize: 8.5,
    color: "#334155",
    marginTop: 1,
  },
  // Patient details box
  patientBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  patientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  patientLabel: {
    fontSize: 8,
    color: "#64748B",
  },
  patientValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: "#1E293B",
  },
  vitalsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 0.5,
    borderColor: "#CBD5E1",
    paddingTop: 4,
    marginTop: 2,
  },
  vitalItem: {
    marginRight: 12,
    fontSize: 8,
    color: "#334155",
  },
  vitalBold: {
    fontFamily: "Helvetica-Bold",
  },
  // Section container
  sectionContainer: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#0F172A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingBottom: 2,
  },
  // Callout box for reason
  reasonBox: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  reasonTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: "#1E40AF",
    marginBottom: 2,
  },
  reasonText: {
    fontSize: 8.5,
    color: "#1E3A8A",
    lineHeight: 1.3,
  },
  // Body text
  clinicalText: {
    fontSize: 8.5,
    color: "#334155",
    lineHeight: 1.3,
    marginBottom: 4,
  },
  // Medications table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderBottomWidth: 1,
    borderColor: "#CBD5E1",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#475569",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  colMed: { width: "45%" },
  colDose: { width: "20%" },
  colTiming: { width: "20%" },
  colDuration: { width: "15%" },
  cellText: {
    fontSize: 8,
    color: "#334155",
  },
  // Investigations list
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 2,
  },
  bulletSymbol: {
    fontSize: 8,
    color: "#334155",
    marginRight: 4,
  },
  bulletText: {
    fontSize: 8,
    color: "#334155",
    flex: 1,
  },
  // Signature block
  signatureBlock: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signatureBox: {
    width: 180,
    borderTopWidth: 1,
    borderColor: "#64748B",
    paddingTop: 4,
    alignItems: "center",
  },
  signDocName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#0F172A",
  },
  signDocMeta: {
    fontSize: 7.5,
    color: "#64748B",
    marginTop: 1,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: "#94A3B8",
  },
});

export function ReferralLetterDocument({
  payload,
}: {
  payload: ReferralPdfPayload;
}) {
  const isPreprinted = payload.letterhead_mode === "preprinted_letterhead";
  const pageStyle = isPreprinted ? styles.pagePreprinted : styles.pageBlankPaper;
  const vitals = payload.clinical.vitals;
  const hasVitals =
    vitals &&
    (vitals.systolic != null ||
      vitals.pulse != null ||
      vitals.temperature != null ||
      vitals.spo2 != null ||
      vitals.weight != null);

  const urgencyStyle =
    payload.urgency === "urgent"
      ? styles.urgencyBadgeUrgent
      : payload.urgency === "priority"
      ? styles.urgencyBadgePriority
      : styles.urgencyBadgeRoutine;

  return (
    <Document title={`Referral Letter - ${payload.patient.full_name}`}>
      <Page size="A4" style={pageStyle}>
        {/* Continuation Header */}
        <View style={styles.continuationHeader} fixed>
          <Text style={styles.continuationText}>
            Medical Referral Letter • Patient: {payload.patient.full_name}{" "}
            {payload.patient.uhid ? `(${payload.patient.uhid})` : ""} • Ref:{" "}
            {payload.referral_id.slice(0, 8).toUpperCase()}
          </Text>
        </View>

        {/* 1. Header (Blank paper mode only) */}
        {!isPreprinted && (
          <View style={styles.headerContainer}>
            <Text style={styles.clinicName}>{payload.clinic.name}</Text>
            {payload.clinic.address && (
              <Text style={styles.clinicMeta}>{payload.clinic.address}</Text>
            )}
            <Text style={styles.clinicMeta}>
              {payload.clinic.phone ? `Phone: ${payload.clinic.phone}` : ""}
              {payload.clinic.email ? ` • Email: ${payload.clinic.email}` : ""}
              {payload.clinic.registration_number
                ? ` • Reg No: ${payload.clinic.registration_number}`
                : ""}
            </Text>

            <View style={styles.doctorContainer}>
              <View>
                <Text style={styles.doctorName}>
                  From: Dr. {payload.referring_doctor.name}
                </Text>
                <Text style={styles.doctorMeta}>
                  {payload.referring_doctor.qualifications || "Consultant"}
                  {payload.referring_doctor.medical_council_reg_no
                    ? ` • Reg No: ${payload.referring_doctor.medical_council_reg_no}`
                    : ""}
                </Text>
              </View>
              <Text style={styles.doctorMeta}>
                Date: {new Date(payload.sent_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        )}

        {/* 2. Referral Title Bar with Urgency Badge */}
        <View style={styles.titleBar}>
          <Text style={styles.titleText}>CLINICAL REFERRAL LETTER</Text>
          <Text style={urgencyStyle}>{payload.urgency} referral</Text>
        </View>

        {/* 3. Recipient Box */}
        <View style={styles.recipientBox}>
          <Text style={styles.recipientLabel}>Referred To:</Text>
          <Text style={styles.recipientName}>
            Dr. {payload.recipient.name}
          </Text>
          {(payload.recipient.facility || payload.recipient.specialty) && (
            <Text style={styles.recipientMeta}>
              {payload.recipient.specialty ? `${payload.recipient.specialty} • ` : ""}
              {payload.recipient.facility || ""}
            </Text>
          )}
          {payload.recipient.contact && (
            <Text style={styles.recipientMeta}>
              Contact: {payload.recipient.contact}
            </Text>
          )}
        </View>

        {/* 4. Patient Demographics & Vitals */}
        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientValue}>
              Patient: {payload.patient.full_name}{" "}
              {payload.patient.age ? `(${payload.patient.age}y` : "("}
              {payload.patient.sex ? ` ${payload.patient.sex.toUpperCase()})` : ")"}
            </Text>
            <Text style={styles.patientValue}>
              Ref: {payload.referral_id.slice(0, 8).toUpperCase()}
            </Text>
          </View>

          <View style={styles.patientRow}>
            <Text style={styles.patientLabel}>
              Phone: {payload.patient.phone || "N/A"}
              {payload.patient.uhid ? ` • UHID: ${payload.patient.uhid}` : ""}
            </Text>
            {payload.patient.address && (
              <Text style={styles.patientLabel}>
                Address: {payload.patient.address}
              </Text>
            )}
          </View>

          {hasVitals && (
            <View style={styles.vitalsRow}>
              {vitals?.systolic != null && vitals?.diastolic != null && (
                <Text style={styles.vitalItem}>
                  BP: <Text style={styles.vitalBold}>{vitals.systolic}/{vitals.diastolic} mmHg</Text>
                </Text>
              )}
              {vitals?.pulse != null && (
                <Text style={styles.vitalItem}>
                  Pulse: <Text style={styles.vitalBold}>{vitals.pulse} bpm</Text>
                </Text>
              )}
              {vitals?.temperature != null && (
                <Text style={styles.vitalItem}>
                  Temp: <Text style={styles.vitalBold}>{vitals.temperature}°F</Text>
                </Text>
              )}
              {vitals?.spo2 != null && (
                <Text style={styles.vitalItem}>
                  SpO2: <Text style={styles.vitalBold}>{vitals.spo2}%</Text>
                </Text>
              )}
              {vitals?.weight != null && (
                <Text style={styles.vitalItem}>
                  Weight: <Text style={styles.vitalBold}>{vitals.weight} kg</Text>
                </Text>
              )}
            </View>
          )}
        </View>

        {/* 5. Reason for Referral Callout */}
        <View style={styles.reasonBox}>
          <Text style={styles.reasonTitle}>REASON FOR REFERRAL:</Text>
          <Text style={styles.reasonText}>{payload.clinical.reason_for_referral}</Text>
        </View>

        {/* 6. Provisional Diagnosis */}
        {payload.clinical.provisional_diagnosis && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Provisional Diagnosis</Text>
            <Text style={styles.clinicalText}>
              {payload.clinical.provisional_diagnosis}
            </Text>
          </View>
        )}

        {/* 7. Detailed Clinical Summary */}
        {payload.clinical.clinical_summary && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Clinical Summary & Notes</Text>
            <Text style={styles.clinicalText}>
              {payload.clinical.clinical_summary}
            </Text>
          </View>
        )}

        {/* 8. Active Medications Snapshot */}
        {payload.clinical.medications && payload.clinical.medications.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Active Medications Snapshot</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colMed]}>Medicine</Text>
              <Text style={[styles.tableHeaderCell, styles.colDose]}>Dosage</Text>
              <Text style={[styles.tableHeaderCell, styles.colTiming]}>Timing</Text>
              <Text style={[styles.tableHeaderCell, styles.colDuration]}>Duration</Text>
            </View>
            {payload.clinical.medications.map((med, idx) => (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cellText, styles.colMed]}>
                  {med.medicine_name}
                </Text>
                <Text style={[styles.cellText, styles.colDose]}>{med.dosage}</Text>
                <Text style={[styles.cellText, styles.colTiming]}>
                  {med.timing || "—"}
                </Text>
                <Text style={[styles.cellText, styles.colDuration]}>
                  {med.duration}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 9. Investigations Advised */}
        {payload.clinical.investigations_advised &&
          payload.clinical.investigations_advised.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Advised Investigations</Text>
              {payload.clinical.investigations_advised.map((test, idx) => (
                <View key={idx} style={styles.bulletRow} wrap={false}>
                  <Text style={styles.bulletSymbol}>•</Text>
                  <Text style={styles.bulletText}>{test}</Text>
                </View>
              ))}
            </View>
          )}

        {/* 10. Referring Doctor Signature Block */}
        <View style={styles.signatureBlock} wrap={false}>
          <View style={styles.signatureBox}>
            <Text style={styles.signDocName}>
              Dr. {payload.referring_doctor.name}
            </Text>
            {payload.referring_doctor.medical_council_reg_no && (
              <Text style={styles.signDocMeta}>
                Reg No: {payload.referring_doctor.medical_council_reg_no}
              </Text>
            )}
            <Text style={styles.signDocMeta}>
              Dated: {new Date(payload.sent_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* 11. Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated by ClinicOS • Confidential Medical Record • Referral Ref:{" "}
            {payload.referral_id.slice(0, 8).toUpperCase()}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
