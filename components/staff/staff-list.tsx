"use client";

import React, { useState } from "react";
import { Membership } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditStaffModal } from "./edit-staff-modal";
import {
  Users,
  Pencil,
  GraduationCap,
  ShieldCheck,
  Phone,
  Stethoscope,
} from "lucide-react";

interface StaffListProps {
  members: Membership[];
  isOwnerOrAdmin: boolean;
}

export function StaffList({ members, isOwnerOrAdmin }: StaffListProps) {
  const [selectedMember, setSelectedMember] = useState<Membership | null>(null);

  const getRoleBadge = (role: string) => {
    switch (role.toLowerCase()) {
      case "owner":
        return <Badge color="primary" size="sm">Owner</Badge>;
      case "doctor":
        return <Badge color="info" size="sm">Doctor</Badge>;
      case "admin":
        return <Badge color="primary" size="sm">Admin</Badge>;
      case "nurse":
        return <Badge color="success" size="sm">Nurse</Badge>;
      case "receptionist":
        return <Badge color="warning" size="sm">Receptionist</Badge>;
      default:
        return <Badge color="gray" size="sm" className="capitalize">{role}</Badge>;
    }
  };

  return (
    <>
      <div className="divide-y divide-gray-100">
        {members.map((m) => {
          const isDoctor = m.role === "doctor" || m.role === "owner";
          return (
            <div
              key={m.id}
              className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center font-bold text-sm shrink-0">
                  {m.role.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-900">
                      {m.full_name || `User ${m.user_id.slice(0, 8)}...`}
                    </span>
                    {getRoleBadge(m.role)}
                    {isDoctor && m.default_specialty && (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded capitalize">
                        {m.default_specialty.replace("_", " ")}
                      </span>
                    )}
                  </div>

                  {/* Doctor Qualifications & Reg No */}
                  {isDoctor && (m.qualifications || m.medical_council_reg_no) && (
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                      {m.qualifications && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#1769E0] bg-blue-50/70 border border-blue-100 px-2 py-0.5 rounded-md text-[11px]">
                          <GraduationCap className="w-3 h-3" />
                          <span>{m.qualifications}</span>
                        </span>
                      )}
                      {m.medical_council_reg_no && (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Reg: {m.medical_council_reg_no}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Contact Info */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    {m.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>{m.phone}</span>
                      </span>
                    )}
                    <span>Joined {new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Edit Action */}
              {isOwnerOrAdmin && (
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedMember(m)}
                    className="h-9 px-3 rounded-xl border-gray-200 text-xs font-semibold hover:bg-gray-100 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5 text-gray-500" />
                    <span>Edit</span>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Staff Modal */}
      {selectedMember && (
        <EditStaffModal
          isOpen={Boolean(selectedMember)}
          onClose={() => setSelectedMember(null)}
          member={selectedMember}
        />
      )}
    </>
  );
}
