import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { buildRxContent } from "./content";
import { effectiveMargins, PAPER } from "./layout";
import type { PrescriptionPdfPayload } from "./types";

export type { PrescriptionPdfPayload } from "./types";

/**
 * The prescription as a PDF (V2-09a 09A-03; V2-09c 09C-04, R-12). The words come from `buildRxContent` (shared with the print view); this file is the layout.
 *
 * - Paper: A4 or A5 from the version's own `paper_size`; every length is scaled for A5 (0.9: the text stays readable on the smaller sheet).
 * - Letterhead: on blank paper the clinic and doctor block is printed at the top; on pre-printed stationery it is not, and NOTHING is printed inside the
 *   clinic's own top and bottom margins (`letterhead_margins`, points; defaults 110 and 60): the page padding, the continuation line of page 2 onward and the
 *   footer all sit outside them.
 * - Determinism: the document's creation and modification date are the version's signature (a signed version renders to the same bytes every time); an
 *   unsigned rendering carries the render time and is never stored.
 * - Fonts are the standard Helvetica set (no embedded font): a character outside it is a known limit (Hindi printing is P3), and must not fail a render.
 */

const RAW_STYLES = {
  // Multi-page continuation header
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
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 2.5,
  },
  bulletSymbol: {
    fontSize: 8.5,
    color: "#334155",
    marginRight: 4,
    lineHeight: 1.25,
  },
  bulletText: {
    fontSize: 8.5,
    color: "#334155",
    flex: 1,
    lineHeight: 1.25,
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
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signatureBox: {
    width: 190,
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
    bottom: 14,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderColor: "#E2E8F0",
    paddingTop: 4,
  },
  regeneratedBanner: {
    borderWidth: 1,
    borderColor: "#B45309",
    padding: 6,
    marginBottom: 8,
  },
  regeneratedText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#92400E",
  },
  footerText: {
    fontSize: 7,
    color: "#94A3B8",
  },
} as const;

const SCALED_KEYS = new Set([
  "fontSize", "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "top", "bottom", "left", "right", "borderRadius", "letterSpacing", "width",
]);

/** The design styles with every length scaled (percent widths, unitless line heights and border widths are kept). */
function scaleStyles(scale: number): ReturnType<typeof StyleSheet.create> {
  if (scale === 1) return StyleSheet.create(RAW_STYLES as never);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, style] of Object.entries(RAW_STYLES)) {
    const scaled: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(style)) scaled[key] = typeof value === "number" && SCALED_KEYS.has(key) ? Math.round(value * scale * 100) / 100 : value;
    out[name] = scaled;
  }
  return StyleSheet.create(out as never);
}

export function PrescriptionDocument({ payload }: { payload: PrescriptionPdfPayload }) {
  const content = buildRxContent(payload);
  const { scale } = PAPER[content.paper];
  const styles = scaleStyles(scale) as Record<keyof typeof RAW_STYLES, never>;
  const s = (n: number) => Math.round(n * scale * 100) / 100;
  const { top: marginTop, bottom: marginBottom } = effectiveMargins(payload);

  // Page geometry. Blank paper: the design margins. Pre-printed: the page starts below the clinic's top margin (with room for the continuation line of page
  // 2 onward) and ends above its bottom margin (with room for the footer), so nothing is printed over the stationery.
  const page = content.preprinted
    ? {
        paddingTop: marginTop + s(16),
        paddingBottom: marginBottom + s(22),
        paddingLeft: s(36),
        paddingRight: s(36),
        fontFamily: "Helvetica",
        fontSize: s(9),
        color: "#1E293B",
        backgroundColor: "#FFFFFF",
      }
    : {
        paddingTop: s(36),
        paddingBottom: s(40),
        paddingLeft: s(36),
        paddingRight: s(36),
        fontFamily: "Helvetica",
        fontSize: s(9),
        color: "#1E293B",
        backgroundColor: "#FFFFFF",
      };
  const continuationTop = content.preprinted ? marginTop : s(14);
  const footerBottom = content.preprinted ? marginBottom + s(3) : s(14);

  const signedAt = payload.signed_at ? new Date(payload.signed_at) : null;
  const stamp = signedAt && !Number.isNaN(signedAt.getTime()) ? signedAt : new Date();

  return (
    <Document title={content.title} creationDate={stamp} modificationDate={stamp}>
      <Page size={content.paper} style={page}>
        {/* Multi-page continuation line (page 2 and later) */}
        <View style={[styles.continuationHeader, { top: continuationTop }]} fixed>
          <Text style={styles.continuationText} render={({ pageNumber, totalPages }) => content.continuation(pageNumber, totalPages)} />
        </View>

        {/* 0. Regenerated copy (V2-09a review S-8): this is not the archived signed original */}
        {content.regenerated ? (
          <View style={styles.regeneratedBanner}>
            <Text style={styles.regeneratedText}>{content.regenerated}</Text>
          </View>
        ) : null}

        {/* 1. Version / Amendment Banner */}
        {content.amendment && (
          <View style={styles.amendmentBanner}>
            <Text style={styles.amendmentTitle}>{content.amendment.title}</Text>
            {content.amendment.reason && <Text style={styles.amendmentText}>{content.amendment.reason}</Text>}
          </View>
        )}

        {/* 2. Clinic & Doctor Branding Header (blank paper only) */}
        {content.letterhead && (
          <View style={styles.headerContainer}>
            <Text style={styles.clinicName}>{content.letterhead.clinicName}</Text>
            {content.letterhead.address && <Text style={styles.clinicMeta}>{content.letterhead.address}</Text>}
            <Text style={styles.clinicMeta}>{content.letterhead.contact}</Text>
            {content.letterhead.statutory ? <Text style={styles.clinicMeta}>{content.letterhead.statutory}</Text> : null}
            <View style={styles.doctorContainer}>
              <View>
                <Text style={styles.doctorName}>{content.letterhead.doctorName}</Text>
                <Text style={styles.doctorMeta}>{content.letterhead.doctorMeta}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 3. Patient Demographics & Vitals Banner */}
        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientValue}>{content.patient.line}</Text>
            <Text style={styles.patientValue}>{content.patient.date}</Text>
          </View>
          <View style={styles.patientRow}>
            <Text style={styles.patientLabel}>{content.patient.contact}</Text>
            <Text style={styles.patientLabel}>{content.patient.visitId}</Text>
          </View>
          {content.vitals.length > 0 && (
            <View style={styles.vitalsRow}>
              {content.vitals.map((v) => (
                <Text key={v.label} style={styles.vitalItem}>
                  {v.label}: <Text style={styles.vitalBold}>{v.value}</Text>
                </Text>
              ))}
            </View>
          )}
        </View>

        {/* 4. Chief Complaints */}
        {content.complaints.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Chief Complaints</Text>
            {content.complaints.map((c, idx) => (
              <Text key={idx} style={styles.clinicalItem}>
                • {c}
              </Text>
            ))}
          </View>
        )}

        {/* 4b. Examination (the structured exam: general signs, abnormal systems, the normal ones in one line) */}
        {content.exam && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Examination</Text>
            {content.exam.general && <Text style={styles.clinicalItem}>General signs: {content.exam.general}</Text>}
            {content.exam.abnormal.map((line, idx) => (
              <Text key={idx} style={styles.clinicalItem}>
                • {line}
              </Text>
            ))}
            {content.exam.normal && <Text style={styles.clinicalItem}>Normal: {content.exam.normal}</Text>}
          </View>
        )}

        {/* 5. Diagnoses */}
        {content.diagnoses.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Diagnoses</Text>
            {content.diagnoses.map((d, idx) => (
              <Text key={idx} style={styles.clinicalItem}>
                • {d}
              </Text>
            ))}
          </View>
        )}

        {/* 6. Rx Medications Table */}
        <View style={styles.sectionContainer}>
          <View style={styles.rxHeader}>
            <Text style={styles.rxSymbol}>Rx</Text>
            <Text style={styles.sectionTitle}>Prescribed Medications</Text>
          </View>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Medicine & Generic Salt</Text>
            <Text style={[styles.tableHeaderCell, styles.colDosage]}>Dosage</Text>
            <Text style={[styles.tableHeaderCell, styles.colTiming]}>Timing</Text>
            <Text style={[styles.tableHeaderCell, styles.colDuration]}>Duration</Text>
          </View>
          {content.medications.map((m) => (
            <View key={m.n} style={styles.tableRow} wrap={false}>
              <Text style={[styles.cellText, styles.colNum]}>{m.n}</Text>
              <View style={styles.colName}>
                <Text style={styles.medName}>{m.name}</Text>
                {m.generic && <Text style={styles.medGeneric}>{m.generic}</Text>}
                {m.note && <Text style={styles.medInstructions}>{m.note}</Text>}
              </View>
              <Text style={[styles.cellText, styles.colDosage]}>{m.dosage}</Text>
              <Text style={[styles.cellText, styles.colTiming]}>{m.timing}</Text>
              <Text style={[styles.cellText, styles.colDuration]}>{m.duration}</Text>
            </View>
          ))}
        </View>

        {/* 7. Investigations Advised */}
        {content.investigations.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Advised Investigations</Text>
            {content.investigations.map((test, idx) => (
              <View key={idx} style={styles.bulletRow} wrap={false}>
                <Text style={styles.bulletSymbol}>•</Text>
                <Text style={styles.bulletText}>{test}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 8. Advice & Lifestyle */}
        {content.advice.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Advice & Lifestyle Instructions</Text>
            {content.advice.map((adv, idx) => (
              <View key={idx} style={styles.bulletRow} wrap={false}>
                <Text style={styles.bulletSymbol}>•</Text>
                <Text style={styles.bulletText}>{adv}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 9. Follow-Up */}
        {content.followUp && (
          <View style={styles.sectionContainer} wrap={false}>
            <Text style={styles.sectionTitle}>Follow-Up</Text>
            <Text style={styles.clinicalItem}>{content.followUp}</Text>
          </View>
        )}

        {/* 10. Doctor Signature Block (atomic: never split across pages) */}
        <View style={styles.signatureBlock} wrap={false}>
          <View style={styles.signatureBox}>
            <Text style={styles.signDocName}>{content.signature.doctor}</Text>
            {content.signature.reg && <Text style={styles.signDocMeta}>{content.signature.reg}</Text>}
            <Text style={styles.signDocMeta}>{content.signature.signedOn}</Text>
          </View>
        </View>

        {/* 11. Footer (every page): the product line as before (blank paper only) and "Rx v{n} · Page x of y" (Q-9 ruling) */}
        <View style={[styles.footer, { bottom: footerBottom }]} fixed>
          <Text style={styles.footerText}>{content.footerLeft}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => content.pageLine(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
