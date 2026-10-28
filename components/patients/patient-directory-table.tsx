"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  TableContainer,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { searchPatients } from "@/features/patients/actions";
import { formatTenDigitsDisplay } from "@/lib/utils/phone";
import {
  Users,
  Search,
  UserPlus,
  ArrowUpRight,
  ShieldCheck,
  User,
  X,
  Loader2,
} from "lucide-react";

export interface PatientRecord {
  id: string;
  full_name: string;
  phone: string;
  abha_id: string | null;
  age: number | null;
  sex: string | null;
  created_at: string;
}

export interface PatientDirectoryTableProps {
  initialPatients: PatientRecord[];
}

export function PatientDirectoryTable({
  initialPatients,
}: PatientDirectoryTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<PatientRecord[] | null>(null);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);

  // Debounced remote search fallback for queries >= 2 characters
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setRemoteResults(null);
      setIsSearchingRemote(false);
      return;
    }

    setIsSearchingRemote(true);
    const timer = setTimeout(async () => {
      try {
        const serverMatches = await searchPatients(trimmed);
        const mapped: PatientRecord[] = serverMatches.map((p) => ({
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          abha_id: p.abha_id ?? null,
          age: p.age ?? null,
          sex: p.sex ?? null,
          created_at: p.created_at,
        }));
        setRemoteResults(mapped);
      } catch (err) {
        console.error("Remote patient search failed:", err);
      } finally {
        setIsSearchingRemote(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Combined filtered results
  const displayedPatients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return initialPatients;
    }

    // Fast local filter
    const queryDigits = query.replace(/\D/g, "");
    const localFiltered = initialPatients.filter((p) => {
      const nameMatch = p.full_name.toLowerCase().includes(query);
      const pDigits = p.phone ? p.phone.replace(/\D/g, "") : "";
      const phoneMatch =
        p.phone.toLowerCase().includes(query) ||
        (queryDigits.length >= 3 && pDigits.includes(queryDigits));
      const abhaMatch = p.abha_id ? p.abha_id.toLowerCase().includes(query) : false;
      const idMatch = p.id.toLowerCase().includes(query);
      return nameMatch || phoneMatch || abhaMatch || idMatch;
    });

    // Merge remote results if available to ensure any records not in initial list are included
    if (remoteResults && remoteResults.length > 0) {
      const seenIds = new Set(localFiltered.map((p) => p.id));
      const combined = [...localFiltered];
      for (const remote of remoteResults) {
        if (!seenIds.has(remote.id)) {
          seenIds.add(remote.id);
          combined.push(remote);
        }
      }
      return combined;
    }

    return localFiltered;
  }, [initialPatients, searchQuery, remoteResults]);

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <Card>
      {/* Table Header & Search Controls */}
      <CardHeader className="py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1769E0]" />
            <span>Patient Records</span>
          </CardTitle>
          <span className="text-xs text-gray-500">
            {hasSearch
              ? `Showing ${displayedPatients.length} of ${initialPatients.length}`
              : `${initialPatients.length} total`}
          </span>
        </div>

        {/* Search input field */}
        <div className="relative w-full sm:w-72 md:w-80">
          <span className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
            {isSearchingRemote ? (
              <Loader2 className="w-4 h-4 text-[#1769E0] animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, phone, or ABHA..."
            className="w-full h-9 ps-9 pe-8 text-xs rounded-lg border border-gray-200 bg-gray-50/60 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] focus:bg-white transition-colors"
          />
          {hasSearch && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 end-0 flex items-center pe-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {initialPatients.length === 0 ? (
          <div className="py-14">
            <EmptyState
              icon={<User className="w-6 h-6" />}
              title="No patients registered yet"
              description="Get started by creating your clinic's first patient intake record."
              action={
                <Link href="/patients/new">
                  <Button
                    variant="primary"
                    size="sm"
                    startIcon={<UserPlus className="w-4 h-4" />}
                  >
                    Register Patient
                  </Button>
                </Link>
              }
            />
          </div>
        ) : displayedPatients.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2.5">
              <Search className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">
              No matching patients found
            </h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
              No patient records match &quot;{searchQuery}&quot;. Check the spelling or phone number.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery("")}
              >
                Clear Search Filter
              </Button>
              <Link href="/patients/new">
                <Button
                  variant="primary"
                  size="sm"
                  startIcon={<UserPlus className="w-4 h-4" />}
                >
                  Register as New Patient
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <TableContainer className="border-0 rounded-none shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Age / Sex</TableHead>
                  <TableHead>National Health ID</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedPatients.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/patients/${p.id}`}
                        className="font-semibold text-gray-900 hover:text-[#1769E0] transition-colors flex items-center gap-2 group"
                      >
                        <span>{p.full_name}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-[#1769E0] transition-opacity" />
                      </Link>
                      <span className="text-xs text-gray-400 font-mono">
                        ID: {p.id.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-gray-700 tabular-nums font-mono">
                        {formatTenDigitsDisplay(p.phone) || p.phone}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {p.age !== null ? `${p.age} yrs` : "—"}
                        {p.sex && ` · `}
                        <span className="capitalize">{p.sex || ""}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.abha_id ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <ShieldCheck className="w-3 h-3" />
                          <span>{p.abha_id}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Unlinked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {new Date(p.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={`/patients/${p.id}`}>
                        <Button variant="ghost" size="sm">
                          View Profile
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
