import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface PrescriptionPdfPayload {
  tenant_id: string;
  visit_id: string;
  prescription_id: string;
  version: number;
  letterhead_mode: "blank_paper" | "preprinted_letterhead";
  amended_at?: string | null;
  amendment_reason?: string | null;
  signed_at?: string | null;

  clinic: {
    name: string;
    address?: string | null;
    phone?: string | null;
    registration_number?: string | null;
    logo_url?: string | null;
  };

  doctor: {
    name: string;
    qualifications?: string | null;
    medical_council_reg_no?: string | null;
    signature_url?: string | null;
  };

  patient: {
    full_name: string;
    age?: number | null;
    sex?: "male" | "female" | "other" | null;
    phone?: string | null;
    address?: string | null;
    abha_id?: string | null;
    uhid?: string | null;
  };

  visit: {
    visit_date: string;
    vitals?: {
      systolic?: number | null;
      diastolic?: number | null;
      pulse?: number | null;
      temperature?: number | null;
      spo2?: number | null;
      weight?: number | null;
      height?: number | null;
      bmi?: number | null;
    } | null;
    chief_complaints?: {
      symptom: string;
      duration_val?: number;
      duration_unit?: string;
    }[];
    clinical_notes?: string | null;
    specialty?: string;
    specialty_notes?: string | null;
  };

  diagnoses: {
    diagnosis_name: string;
    icd11_code?: string | null;
    snomed_concept_id?: string | null;
  }[];

  medications: {
    medicine_name: string;
    generic_name?: string | null;
    dose_form?: string | null;
    dosage: string;
    timing?: string | null;
    duration: string;
    special_instructions?: string | null;
    quantity?: number | string | null;
  }[];

  investigations_advised?: string[];
  advice?: string[];
  follow_up_date?: string | null;
}

const styles = StyleSheet.create({
  pageBlankPaper: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
  },
  pagePreprinted: {
    paddingTop: 110, // ~39mm letterhead pad margin
    paddingBottom: 60, // ~21mm footer pad margin
    paddingLeft: 36,
    paddingRight: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
  },
  // Amendment banner
  amendmentBanner: {
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
    borderRadius: 4,
    padding: 6,
    marginBottom: 10,
  },
  amendmentTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#92400E",
    marginBottom: 2,
  },
  amendmentText: {
    fontSize: 8,
    color: "#B45309",
  },
  // Header section
  headerContainer: {
    borderBottomWidth: 1.5,
    borderColor: "#E2E8F0",
    paddingBottom: 10,
    marginBottom: 10,
  },
  clinicName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    color: "#0F172A",
    marginBottom: 3,
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
    fontSize: 11,
    color: "#1E293B",
  },
  doctorMeta: {
    fontSize: 8,
    color: "#64748B",
  },
  // Patient banner
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
  // Clinical Findings & Diagnosis
  sectionContainer: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: "#0F172A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingBottom: 2,
  },
  clinicalItem: {
    fontSize: 8.5,
    color: "#334155",
    marginBottom: 2,
  },
  // Rx Medications Table
  rxHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  rxSymbol: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#1769E0",
    marginRight: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderWidth: 0.5,
    borderColor: "#CBD5E1",
    padding: 4,
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#334155",
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#E2E8F0",
    padding: 5,
  },
  colNum: { width: "5%" },
  colName: { width: "45%" },
  colDosage: { width: "15%" },
  colTiming: { width: "20%" },
  colDuration: { width: "15%" },
  medName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#0F172A",
  },
  medGeneric: {
    fontSize: 7.5,
    color: "#64748B",
    marginTop: 1,
  },
  medInstructions: {
    fontSize: 7.5,
    color: "#1E40AF",
    marginTop: 2,
  },
  cellText: {
    fontSize: 8,
    color: "#334155",
  },
  // Sign-off
  signatureBlock: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signatureBox: {
    width: 180,
    borderTopWidth: 1,
    borderColor: "#94A3B8",
    paddingTop: 6,
    alignItems: "flex-start",
  },
  signDocName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: "#0F172A",
  },
  signDocMeta: {
    fontSize: 8,
    color: "#64748B",
    marginTop: 1,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingTop: 4,
  },
  footerText: {
    fontSize: 7,
    color: "#94A3B8",
  },
});

export function PrescriptionDocument({ payload }: { payload: PrescriptionPdfPayload }) {
  const isPreprinted = payload.letterhead_mode === "preprinted_letterhead";
  const isAmended = payload.version > 1 || Boolean(payload.amendment_reason);

  const vitals = payload.visit.vitals;
  const hasVitals =
    vitals &&
    (vitals.systolic != null ||
      vitals.pulse != null ||
      vitals.temperature != null ||
      vitals.spo2 != null ||
      vitals.weight != null);

  const bmiFormatted =
    vitals?.bmi != null
      ? vitals.bmi.toFixed(1)
      : vitals?.weight && vitals?.height
        ? (vitals.weight / Math.pow(vitals.height / 100, 2)).toFixed(1)
        : null;

  return (
    <Document title={`Prescription-${payload.patient.full_name}-v${payload.version}`}>
      <Page size="A4" style={isPreprinted ? styles.pagePreprinted : styles.pageBlankPaper}>
        {/* 1. Version / Amendment Banner */}
        {isAmended && (
          <View style={styles.amendmentBanner}>
            <Text style={styles.amendmentTitle}>
              AMENDED PRESCRIPTION (v{payload.version})
              {payload.amended_at ? ` • ${new Date(payload.amended_at).toLocaleDateString()}` : ""}
            </Text>
            {payload.amendment_reason && (
              <Text style={styles.amendmentText}>Reason: {payload.amendment_reason}</Text>
            )}
          </View>
        )}

        {/* 2. Clinic & Doctor Branding Header (Blank Paper Mode only) */}
        {!isPreprinted && (
          <View style={styles.headerContainer}>
            <Text style={styles.clinicName}>{payload.clinic.name}</Text>
            {payload.clinic.address && <Text style={styles.clinicMeta}>{payload.clinic.address}</Text>}
            <Text style={styles.clinicMeta}>
              {payload.clinic.phone ? `Phone: ${payload.clinic.phone}` : ""}
              {payload.clinic.registration_number
                ? ` • Reg No: ${payload.clinic.registration_number}`
                : ""}
            </Text>

            <View style={styles.doctorContainer}>
              <View>
                <Text style={styles.doctorName}>Dr. {payload.doctor.name}</Text>
                <Text style={styles.doctorMeta}>
                  {payload.doctor.qualifications || "Consultant"}
                  {payload.doctor.medical_council_reg_no
                    ? ` • Reg No: ${payload.doctor.medical_council_reg_no}`
                    : ""}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 3. Patient Demographics & Vitals Banner */}
        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientValue}>
              Patient: {payload.patient.full_name}{" "}
              {payload.patient.age ? `(${payload.patient.age}y` : "("}
              {payload.patient.sex ? ` ${payload.patient.sex.toUpperCase()})` : ")"}
            </Text>
            <Text style={styles.patientValue}>Date: {payload.visit.visit_date}</Text>
          </View>

          <View style={styles.patientRow}>
            <Text style={styles.patientLabel}>
              Phone: {payload.patient.phone || "N/A"}
              {payload.patient.uhid ? ` • UHID: ${payload.patient.uhid}` : ""}
              {payload.patient.abha_id ? ` • ABHA: ${payload.patient.abha_id}` : ""}
            </Text>
            <Text style={styles.patientLabel}>
              Visit ID: {payload.visit_id.slice(0, 8).toUpperCase()}
            </Text>
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
              {bmiFormatted && (
                <Text style={styles.vitalItem}>
                  BMI: <Text style={styles.vitalBold}>{bmiFormatted}</Text>
                </Text>
              )}
            </View>
          )}
        </View>

        {/* 4. Clinical Findings / Chief Complaints */}
        {payload.visit.chief_complaints && payload.visit.chief_complaints.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Chief Complaints</Text>
            {payload.visit.chief_complaints.map((c, idx) => (
              <Text key={idx} style={styles.clinicalItem}>
                • {c.symptom} {c.duration_val ? `(${c.duration_val} ${c.duration_unit || "days"})` : ""}
              </Text>
            ))}
          </View>
        )}

        {/* 5. Diagnoses */}
        {payload.diagnoses && payload.diagnoses.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Diagnoses</Text>
            {payload.diagnoses.map((d, idx) => (
              <Text key={idx} style={styles.clinicalItem}>
                • {d.diagnosis_name} {d.icd11_code ? `[ICD-11: ${d.icd11_code}]` : ""}
              </Text>
            ))}
          </View>
        )}

        {/* 6. Rx Medications Table */}
        <View style={styles.sectionContainer}>
          <View style={styles.rxHeader}>
            <Text style={styles.rxSymbol}>℞</Text>
            <Text style={styles.sectionTitle}>Prescribed Medications</Text>
          </View>

          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Medicine & Generic Salt</Text>
            <Text style={[styles.tableHeaderCell, styles.colDosage]}>Dosage</Text>
            <Text style={[styles.tableHeaderCell, styles.colTiming]}>Timing</Text>
            <Text style={[styles.tableHeaderCell, styles.colDuration]}>Duration</Text>
          </View>

          {/* Table Rows */}
          {payload.medications.map((item, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.cellText, styles.colNum]}>{idx + 1}</Text>
              <View style={styles.colName}>
                <Text style={styles.medName}>
                  {item.medicine_name} {item.dose_form ? `(${item.dose_form})` : ""}
                </Text>
                {item.generic_name && (
                  <Text style={styles.medGeneric}>{item.generic_name}</Text>
                )}
                {item.special_instructions && (
                  <Text style={styles.medInstructions}>Note: {item.special_instructions}</Text>
                )}
              </View>
              <Text style={[styles.cellText, styles.colDosage]}>{item.dosage}</Text>
              <Text style={[styles.cellText, styles.colTiming]}>{item.timing || "After food"}</Text>
              <Text style={[styles.cellText, styles.colDuration]}>{item.duration}</Text>
            </View>
          ))}
        </View>

        {/* 7. Investigations Advised */}
        {payload.investigations_advised && payload.investigations_advised.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Advised Investigations</Text>
            {payload.investigations_advised.map((test, idx) => (
              <Text key={idx} style={styles.clinicalItem}>• {test}</Text>
            ))}
          </View>
        )}

        {/* 8. Advice & Lifestyle */}
        {payload.advice && payload.advice.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Advice & Lifestyle Instructions</Text>
            {payload.advice.map((adv, idx) => (
              <Text key={idx} style={styles.clinicalItem}>• {adv}</Text>
            ))}
          </View>
        )}

        {/* 9. Follow-Up */}
        {payload.follow_up_date && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Follow-Up</Text>
            <Text style={styles.clinicalItem}>Review on: {payload.follow_up_date}</Text>
          </View>
        )}

        {/* 10. Doctor Signature Block */}
        <View style={styles.signatureBlock}>
          <View style={styles.signatureBox}>
            <Text style={styles.signDocName}>Dr. {payload.doctor.name}</Text>
            {payload.doctor.medical_council_reg_no && (
              <Text style={styles.signDocMeta}>
                Reg No: {payload.doctor.medical_council_reg_no}
              </Text>
            )}
            <Text style={styles.signDocMeta}>
              Signed on {payload.signed_at ? new Date(payload.signed_at).toLocaleDateString() : payload.visit.visit_date}
            </Text>
          </View>
        </View>

        {/* 11. Footer (Blank paper mode only) */}
        {!isPreprinted && (
          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>
              Generated by ClinicOS • Confidential Medical Record • v{payload.version}
            </Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
        )}
      </Page>
    </Document>
  );
}
