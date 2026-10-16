"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { updatePatient } from "@/features/patients/actions";
import { Patient } from "@/lib/db/types";
import { User, Phone, MapPin, Shield, AlertTriangle, HeartPulse, Save } from "lucide-react";

interface EditPatientModalProps {
  patient: Patient;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (updated: Patient) => void;
}

export function EditPatientModal({
  patient,
  isOpen,
  onClose,
  onSuccess,
}: EditPatientModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Address parsing
  const addr = (patient.address as Record<string, string>) || {};
  const ec = (patient.emergency_contact as Record<string, string>) || {};

  const [fullName, setFullName] = useState(patient.full_name || "");
  const [phone, setPhone] = useState(patient.phone || "");
  const [dob, setDob] = useState<string | null>(patient.date_of_birth || null);
  const [age, setAge] = useState<number | null>(patient.age ?? null);
  const [sex, setSex] = useState<"male" | "female" | "other" | "">(patient.sex || "");
  const [abhaId, setAbhaId] = useState(patient.abha_id || "");

  const [addressLine1, setAddressLine1] = useState(addr.line1 || "");
  const [city, setCity] = useState(addr.city || "");
  const [state, setState] = useState(addr.state || "");
  const [pincode, setPincode] = useState(addr.pincode || "");

  const [allergiesText, setAllergiesText] = useState((patient.allergies || []).join(", "));
  const [chronicText, setChronicText] = useState((patient.chronic_conditions || []).join(", "));

  const [emergencyName, setEmergencyName] = useState(ec.name || "");
  const [emergencyPhone, setEmergencyPhone] = useState(ec.phone || "");
  const [emergencyRelation, setEmergencyRelation] = useState(ec.relation || "");

  // Reset form when patient changes
  useEffect(() => {
    if (patient) {
      setFullName(patient.full_name || "");
      setPhone(patient.phone || "");
      setDob(patient.date_of_birth || null);
      setAge(patient.age ?? null);
      setSex(patient.sex || "");
      setAbhaId(patient.abha_id || "");

      const a = (patient.address as Record<string, string>) || {};
      setAddressLine1(a.line1 || "");
      setCity(a.city || "");
      setState(a.state || "");
      setPincode(a.pincode || "");

      setAllergiesText((patient.allergies || []).join(", "));
      setChronicText((patient.chronic_conditions || []).join(", "));

      const e = (patient.emergency_contact as Record<string, string>) || {};
      setEmergencyName(e.name || "");
      setEmergencyPhone(e.phone || "");
      setEmergencyRelation(e.relation || "");
      setError(null);
    }
  }, [patient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const allergies = allergiesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const chronic_conditions = chronicText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const hasAddress = addressLine1 || city || state || pincode;
    const address = hasAddress
      ? {
          line1: addressLine1.trim(),
          city: city.trim(),
          state: state.trim(),
          pincode: pincode.trim(),
        }
      : null;

    const hasEmergency = emergencyName || emergencyPhone || emergencyRelation;
    const emergency_contact = hasEmergency
      ? {
          name: emergencyName.trim(),
          phone: emergencyPhone.trim(),
          relation: emergencyRelation.trim(),
        }
      : null;

    const result = await updatePatient(patient.id, {
      full_name: fullName.trim(),
      phone: phone.trim(),
      date_of_birth: dob,
      age: age,
      sex: sex ? (sex as "male" | "female" | "other") : null,
      abha_id: abhaId.trim() !== "" ? abhaId.trim() : null,
      address,
      allergies,
      chronic_conditions,
      emergency_contact,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    onSuccess?.(result.patient);
    onClose();
    router.refresh();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="lg"
      title="Edit Patient Information"
      description={`Updating demographics and health identity for ${patient.full_name}`}
    >
      <form onSubmit={handleSubmit} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {error && (
          <Alert type="error" title="Update Failed">
            {error}
          </Alert>
        )}

        {/* Section 1: Core Demographics */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-[#1769E0]" />
            Basic Demographics
          </h4>

          <Field label="Full Name" htmlFor="edit-name" required>
            <Input
              id="edit-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone Number" htmlFor="edit-phone" required>
              <Input
                id="edit-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile number"
              />
            </Field>

            <Field label="Sex / Gender" htmlFor="edit-sex">
              <Select
                id="edit-sex"
                value={sex}
                onChange={(e) => setSex(e.target.value as "male" | "female" | "other" | "")}
              >
                <option value="">Select Sex</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>

          <AgeDobInput
            dobValue={dob}
            ageValue={age}
            onDobChange={setDob}
            onAgeChange={setAge}
            disabled={loading}
          />
        </div>

        {/* Section 2: ABDM Health Identity */}
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            ABDM / ABHA Identity
          </h4>

          <Field
            label="ABHA Number / Address"
            htmlFor="edit-abha"
            helpText="14-digit ABHA ID or abha@abdm address"
          >
            <Input
              id="edit-abha"
              value={abhaId}
              onChange={(e) => setAbhaId(e.target.value)}
              placeholder="e.g. 91-1234-5678-9012"
            />
          </Field>
        </div>

        {/* Section 3: Clinical Background (Allergies & Chronic Conditions) */}
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <HeartPulse className="w-3.5 h-3.5 text-rose-600" />
            Allergies & Chronic Conditions
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Known Allergies"
              htmlFor="edit-allergies"
              helpText="Comma-separated (e.g. Penicillin, Peanuts)"
            >
              <Input
                id="edit-allergies"
                value={allergiesText}
                onChange={(e) => setAllergiesText(e.target.value)}
                placeholder="e.g. Penicillin, Sulfa"
              />
            </Field>

            <Field
              label="Chronic Conditions"
              htmlFor="edit-chronic"
              helpText="Comma-separated (e.g. Hypertension, Type 2 Diabetes)"
            >
              <Input
                id="edit-chronic"
                value={chronicText}
                onChange={(e) => setChronicText(e.target.value)}
                placeholder="e.g. Hypertension, Asthma"
              />
            </Field>
          </div>
        </div>

        {/* Section 4: Address Information */}
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-gray-500" />
            Residential Address
          </h4>

          <Field label="Street / Flat / Locality" htmlFor="edit-address">
            <Input
              id="edit-address"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="House No, Street, Landmark"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="City" htmlFor="edit-city">
              <Input
                id="edit-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
              />
            </Field>
            <Field label="State" htmlFor="edit-state">
              <Input
                id="edit-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="State"
              />
            </Field>
            <Field label="PIN Code" htmlFor="edit-pin">
              <Input
                id="edit-pin"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="PIN"
              />
            </Field>
          </div>
        </div>

        {/* Section 5: Emergency Contact */}
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-amber-600" />
            Emergency Contact (Optional)
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Contact Person Name" htmlFor="edit-ec-name">
              <Input
                id="edit-ec-name"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                placeholder="Name"
              />
            </Field>
            <Field label="Relationship" htmlFor="edit-ec-rel">
              <Input
                id="edit-ec-rel"
                value={emergencyRelation}
                onChange={(e) => setEmergencyRelation(e.target.value)}
                placeholder="e.g. Spouse, Father"
              />
            </Field>
            <Field label="Phone" htmlFor="edit-ec-phone">
              <Input
                id="edit-ec-phone"
                type="tel"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="Phone number"
              />
            </Field>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            startIcon={<Save className="w-4 h-4" />}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
