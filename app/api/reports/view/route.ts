import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl, SupabaseStorageProvider } from "@/lib/storage";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const download = searchParams.get("download") === "true";

    if (!token || typeof token !== "string" || token.length < 32) {
      return NextResponse.json(
        { error: "Invalid or missing token parameter." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // 1. Fetch token joined with document, tenant, and patient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shareToken, error: tokenErr } = await (admin.from("document_share_tokens") as any)
      .select("*, patient_documents(*, tenants(name, phone, address, logo_url), patients(full_name))")
      .eq("token", token)
      .single();

    if (tokenErr || !shareToken) {
      return NextResponse.json(
        { error: "This document link has expired or is invalid. Please contact your clinic for a new link." },
        { status: 404 }
      );
    }

    // 2. Check if revoked
    if (shareToken.revoked_at) {
      return NextResponse.json(
        { error: "This document link has been revoked. Please contact your clinic for a new link." },
        { status: 410 }
      );
    }

    // 3. Check expiration
    const now = new Date();
    const expiresAt = new Date(shareToken.expires_at);
    if (expiresAt.getTime() <= now.getTime()) {
      return NextResponse.json(
        { error: "This document link has expired. Please contact your clinic for a new link." },
        { status: 410 }
      );
    }

    const doc = shareToken.patient_documents;
    if (!doc) {
      return NextResponse.json(
        { error: "Underlying document not found." },
        { status: 404 }
      );
    }

    // 4. Atomically increment access_count & stamp last_accessed_at
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("document_share_tokens") as any)
      .update({
        access_count: (shareToken.access_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", shareToken.id);

    // 5. Generate short-lived signed URL (600 seconds)
    const storageProvider = new SupabaseStorageProvider({
      defaultBucket: "clinic-records",
      client: admin,
    });

    const { signedUrl } = await getSignedUrl(
      {
        path: doc.storage_path,
        bucket: "clinic-records",
        expiresInSeconds: 600,
        downloadFilename: doc.original_filename,
      },
      storageProvider
    );

    // If download requested directly, redirect
    if (download) {
      return NextResponse.redirect(signedUrl, { status: 302 });
    }

    const clinic = doc.tenants || { name: "Clinic", phone: null, address: null, logo_url: null };
    const patientName = doc.patients?.full_name || "Patient";

    return NextResponse.json({
      success: true,
      document: {
        id: doc.id,
        title: doc.title,
        document_type: doc.document_type,
        report_date: doc.report_date,
        original_filename: doc.original_filename,
        file_size_bytes: doc.file_size_bytes,
        mime_type: doc.mime_type,
        is_abnormal: doc.is_abnormal,
        notes: doc.notes,
      },
      clinic,
      patient_name: patientName,
      signed_url: signedUrl,
      expires_at: shareToken.expires_at,
    });
  } catch (err: unknown) {
    console.error("[app/api/reports/view/route] Error verifying token:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while loading this document." },
      { status: 500 }
    );
  }
}
