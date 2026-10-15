"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  searchMedicines,
  addPrescriptionItem,
  removePrescriptionItem,
  saveDoctorProtocolTemplate,
  getDoctorProtocolTemplates,
  type DoctorProtocolTemplate,
} from "@/features/prescriptions/actions";
import {
  PrescriptionItemInput,
  MedicineSearchResult,
  STANDARD_FREQUENCIES,
  STANDARD_FOOD_RELATIONS,
  STANDARD_DURATIONS,
  normalizeDuration,
} from "@/features/prescriptions/schema";
import { PrescriptionItem } from "@/lib/db/types";
import {
  Search,
  Plus,
  Trash2,
  Bookmark,
  Sparkles,
  ShieldAlert,
  Clock,
  Check,
  AlertCircle,
  X,
  FileCheck,
  Pill,
  BookOpen,
} from "lucide-react";

interface PrescriptionBuilderProps {
  visitId: string;
  patientAllergies?: string[];
  initialItems?: PrescriptionItem[];
  onItemsChange?: (items: PrescriptionItem[]) => void;
  onRepeatLastRx?: () => void;
  hasPastRx?: boolean;
  disabled?: boolean;
}

export function PrescriptionBuilder({
  visitId,
  patientAllergies = [],
  initialItems = [],
  onItemsChange,
  onRepeatLastRx,
  hasPastRx = false,
  disabled = false,
}: PrescriptionBuilderProps) {
  const [items, setItems] = useState<PrescriptionItem[]>(initialItems);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MedicineSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Staging state for active drug being added
  const [stagedDrug, setStagedDrug] = useState<{
    medicine_name: string;
    generic_name?: string | null;
    dose_form?: string | null;
    cdci_brand_id?: string | null;
    cdci_generic_id?: string | null;
  } | null>(null);

  // Selected 1-tap dosage chips for staged drug
  const [frequency, setFrequency] = useState<string>("1-0-1");
  const [customFrequency, setCustomFrequency] = useState<string>("");
  const [foodRelation, setFoodRelation] = useState<string>("After food");
  const [duration, setDuration] = useState<string>("5d");
  const [customDuration, setCustomDuration] = useState<string>("");
  const [specialInstructions, setSpecialInstructions] = useState<string>("");

  // Protocol Templates State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<DoctorProtocolTemplate[]>([]);

  // Delete confirmation state
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync initialItems
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced CDCI drug search (<100ms response)
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchMedicines(query.trim(), 15);
        if (res.success) {
          setSearchResults(res.results);
          setIsDropdownOpen(true);
        }
      } catch (err) {
        console.error("Medicine search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [query]);

  // Load doctor protocol templates
  const loadTemplates = async () => {
    try {
      const res = await getDoctorProtocolTemplates();
      if (res.success) {
        setSavedTemplates(res.templates);
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  };

  const openTemplateDrawer = () => {
    loadTemplates();
    setIsTemplateModalOpen(true);
  };

  // Select drug from search
  const handleSelectDrug = (drug: {
    medicine_name: string;
    generic_name?: string | null;
    dose_form?: string | null;
    cdci_brand_id?: string | null;
    cdci_generic_id?: string | null;
    default_dosage?: string | null;
    default_timing?: string | null;
    default_duration?: string | null;
  }) => {
    setStagedDrug({
      medicine_name: drug.medicine_name,
      generic_name: drug.generic_name,
      dose_form: drug.dose_form,
      cdci_brand_id: drug.cdci_brand_id,
      cdci_generic_id: drug.cdci_generic_id,
    });
    setFrequency(drug.default_dosage || "1-0-1");
    setFoodRelation(drug.default_timing || "After food");
    setDuration(drug.default_duration || "5d");
    setQuery("");
    setIsDropdownOpen(false);
  };

  // Commit staged drug to prescription
  const handleAddStagedDrug = async () => {
    if (!stagedDrug || disabled) return;
    setErrorMsg(null);

    const activeFreq = customFrequency.trim() || frequency;
    const activeDur = normalizeDuration(customDuration.trim() || duration);

    const newItemPayload: PrescriptionItemInput = {
      medicine_name: stagedDrug.medicine_name,
      generic_name: stagedDrug.generic_name || null,
      dose_form: stagedDrug.dose_form || null,
      dosage: activeFreq,
      timing: foodRelation,
      duration: activeDur,
      special_instructions: specialInstructions.trim() || null,
      cdci_brand_id: stagedDrug.cdci_brand_id || null,
      cdci_generic_id: stagedDrug.cdci_generic_id || null,
      sort_order: items.length,
    };

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticItem: PrescriptionItem = {
      id: tempId,
      prescription_id: "pending",
      medicine_name: newItemPayload.medicine_name,
      generic_name: newItemPayload.generic_name ?? null,
      dose_form: newItemPayload.dose_form ?? null,
      dosage: newItemPayload.dosage,
      timing: newItemPayload.timing ?? null,
      duration: newItemPayload.duration,
      special_instructions: newItemPayload.special_instructions ?? null,
      cdci_brand_id: newItemPayload.cdci_brand_id ?? null,
      cdci_generic_id: newItemPayload.cdci_generic_id ?? null,
      sort_order: items.length,
      created_at: new Date().toISOString(),
    };

    const nextList = [...items, optimisticItem];
    setItems(nextList);
    onItemsChange?.(nextList);

    // Reset staging
    setStagedDrug(null);
    setCustomFrequency("");
    setCustomDuration("");
    setSpecialInstructions("");

    try {
      const res = await addPrescriptionItem(visitId, newItemPayload);
      if (res.success) {
        const resolvedList = nextList.map((i) =>
          i.id === tempId ? { ...i, id: res.itemId, prescription_id: res.prescriptionId } : i
        );
        setItems(resolvedList);
        onItemsChange?.(resolvedList);
      } else {
        const reverted = items.filter((i) => i.id !== tempId);
        setItems(reverted);
        onItemsChange?.(reverted);
        setErrorMsg(res.error || "Failed to record medication.");
      }
    } catch (err: unknown) {
      const reverted = items.filter((i) => i.id !== tempId);
      setItems(reverted);
      onItemsChange?.(reverted);
      setErrorMsg(err instanceof Error ? err.message : "Failed to record medication.");
    }
  };

  // Remove medication
  const handleConfirmRemove = async (itemId: string) => {
    if (disabled) return;
    setErrorMsg(null);
    setItemToDelete(null);

    const prevList = [...items];
    const nextList = items.filter((i) => i.id !== itemId);
    setItems(nextList);
    onItemsChange?.(nextList);

    try {
      const res = await removePrescriptionItem(itemId, visitId);
      if (!res.success) {
        setItems(prevList);
        onItemsChange?.(prevList);
        setErrorMsg(res.error || "Failed to remove medication.");
      }
    } catch (err: unknown) {
      setItems(prevList);
      onItemsChange?.(prevList);
      setErrorMsg(err instanceof Error ? err.message : "Failed to remove medication.");
    }
  };

  // Save current items as protocol template
  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim() || items.length === 0) return;
    setIsSavingTemplate(true);
    try {
      const templateItems = items.map((i, idx) => ({
        medicine_name: i.medicine_name,
        generic_name: i.generic_name,
        dose_form: i.dose_form,
        dosage: i.dosage,
        timing: i.timing,
        duration: i.duration,
        special_instructions: i.special_instructions,
        cdci_brand_id: i.cdci_brand_id,
        cdci_generic_id: i.cdci_generic_id,
        sort_order: i.sort_order ?? idx,
      }));

      const res = await saveDoctorProtocolTemplate({
        template_name: newTemplateName.trim(),
        items: templateItems,
      });

      if (res.success) {
        setNewTemplateName("");
        await loadTemplates();
      } else {
        setErrorMsg(res.error || "Failed to save template.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Apply a protocol template
  const handleApplyTemplate = async (template: DoctorProtocolTemplate) => {
    if (disabled) return;
    setIsTemplateModalOpen(false);

    for (const item of template.items) {
      try {
        await addPrescriptionItem(visitId, item);
      } catch (err) {
        console.error("Failed to add template item:", err);
      }
    }

    // Refresh items
    window.location.reload();
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-6">
      {/* 1. TOP HEADER & TOOLBAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xl font-serif font-black text-brand-600">℞</span>
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Electronic Prescription Builder (CDCI Drug Master)
            </h3>
            <p className="text-xs text-gray-500">
              {items.length} {items.length === 1 ? "medication" : "medications"} prescribed
            </p>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {hasPastRx && onRepeatLastRx && (
            <button
              type="button"
              disabled={disabled}
              onClick={onRepeatLastRx}
              className="min-h-[36px] px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>Repeat Last Rx</span>
            </button>
          )}

          <button
            type="button"
            onClick={openTemplateDrawer}
            className="min-h-[36px] px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <BookOpen className="h-3.5 w-3.5 text-brand-600" />
            <span>Protocol Templates</span>
          </button>
        </div>
      </div>

      {/* 2. ALLERGY WARNING BANNER */}
      {patientAllergies.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 shadow-xs flex items-center gap-3"
        >
          <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-bold text-amber-900">Patient Allergy Alert: </span>
            <span className="text-xs text-amber-800">
              Recorded allergies to{" "}
              <span className="font-semibold underline">{patientAllergies.join(", ")}</span>.
              Verify prescribed medication ingredients carefully.
            </span>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-600 hover:text-rose-800 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. CDCI DRUG SEARCH AUTOCOMPLETE */}
      <div className="relative">
        <label htmlFor="medicine-search-input" className="block text-xs font-semibold text-gray-700 mb-1">
          Search CDCI Medicine or Brand Name:
        </label>
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="medicine-search-input"
            ref={searchInputRef}
            type="text"
            disabled={disabled}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setIsDropdownOpen(true);
            }}
            placeholder="Type brand name (e.g. Augmentin, Dolo) or generic salt (e.g. Paracetamol, Amoxicillin)..."
            className="w-full min-h-[44px] pl-10 pr-10 rounded-lg border border-gray-300 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
              aria-label="Clear medicine search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {isDropdownOpen && (
          <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto divide-y divide-gray-100"
          >
            {searchResults.map((drug) => (
              <button
                key={drug.id}
                type="button"
                onClick={() =>
                  handleSelectDrug({
                    medicine_name: drug.medicine_name,
                    generic_name: drug.generic_name,
                    dose_form: drug.dose_form,
                    cdci_brand_id: drug.is_custom ? null : drug.id,
                    default_dosage: drug.default_dosage,
                    default_timing: drug.default_timing,
                    default_duration: drug.default_duration,
                  })
                }
                className="w-full min-h-[48px] p-3 text-left hover:bg-gray-50 flex items-center justify-between transition-colors"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900 uppercase">
                      {drug.medicine_name}
                    </span>
                    {drug.dose_form && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                        {drug.dose_form}
                      </span>
                    )}
                    {drug.is_favorite && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        ★ Doctor Favorite
                      </span>
                    )}
                  </div>
                  {drug.generic_name && (
                    <span className="text-[11px] text-gray-500 italic block truncate">
                      {drug.generic_name}
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-brand-600 font-semibold shrink-0">
                  Select ℞
                </div>
              </button>
            ))}

            {/* Custom Medicine Fallback */}
            {query.trim().length > 1 && (
              <button
                type="button"
                onClick={() =>
                  handleSelectDrug({
                    medicine_name: query.trim(),
                    generic_name: null,
                    dose_form: "Tablet",
                    cdci_brand_id: null,
                  })
                }
                className="w-full min-h-[44px] p-3 text-left hover:bg-brand-50/60 bg-gray-50/50 flex items-center gap-2 transition-colors text-brand-700"
              >
                <Plus className="h-4 w-4 text-brand-600" />
                <span className="text-xs font-semibold">
                  + Add as custom medicine: &quot;{query.trim()}&quot;
                </span>
                <span className="text-[11px] text-gray-400 ml-auto font-normal">
                  Saves to personal doctor formulary
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. 1-TAP FAST DOSAGE CHIP STAGING PANEL */}
      {stagedDrug && (
        <div className="rounded-xl border-2 border-brand-500 bg-brand-50/20 p-4 space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-brand-200">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
                Configure Dosage & Instructions:
              </span>
              <h4 className="text-sm font-bold text-gray-900 uppercase">
                {stagedDrug.medicine_name}
              </h4>
              {stagedDrug.generic_name && (
                <p className="text-xs text-gray-500 italic">{stagedDrug.generic_name}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStagedDrug(null)}
              className="p-1 rounded text-gray-400 hover:text-gray-600"
              aria-label="Cancel drug configuration"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Row A: Frequency Chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Frequency:
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {STANDARD_FREQUENCIES.map((freq) => {
                const isSelected = frequency === freq && !customFrequency;
                return (
                  <button
                    key={freq}
                    type="button"
                    onClick={() => {
                      setFrequency(freq);
                      setCustomFrequency("");
                    }}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-brand-600 text-white shadow-xs"
                        : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {freq}
                  </button>
                );
              })}
              <input
                type="text"
                placeholder="Custom (e.g. 1-0-2)"
                value={customFrequency}
                onChange={(e) => setCustomFrequency(e.target.value)}
                className="w-32 min-h-[38px] px-2.5 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Row B: Food Relation Chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Food Timing:
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {STANDARD_FOOD_RELATIONS.map((rel) => {
                const isSelected = foodRelation === rel;
                return (
                  <button
                    key={rel}
                    type="button"
                    onClick={() => setFoodRelation(rel)}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-brand-600 text-white shadow-xs"
                        : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {rel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row C: Duration Chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Duration:
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {STANDARD_DURATIONS.map((dur) => {
                const isSelected = duration === dur && !customDuration;
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => {
                      setDuration(dur);
                      setCustomDuration("");
                    }}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-brand-600 text-white shadow-xs"
                        : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {dur}
                  </button>
                );
              })}
              <input
                type="text"
                placeholder="Custom (e.g. 15 days)"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                className="w-36 min-h-[38px] px-2.5 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Special Instructions & Add Button */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <input
              type="text"
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="Special instructions (e.g. With warm water, Do not crush)..."
              className="flex-1 w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500"
            />

            <button
              type="button"
              onClick={handleAddStagedDrug}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
            >
              <Check className="h-4 w-4" />
              <span>Add to Prescription</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. PRESCRIBED MEDICATIONS TABLE */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Prescribed Medications:
        </h4>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-xs text-gray-500 bg-gray-50/30">
            No medications prescribed yet. Search for brands or generic salts above to begin.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-xs divide-y divide-gray-100">
            {items.map((item, index) => (
              <div
                key={item.id || index}
                className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-gray-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
                    <span className="text-xs font-bold text-gray-900 uppercase">
                      {item.medicine_name}
                    </span>
                    {item.dose_form && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                        {item.dose_form}
                      </span>
                    )}
                  </div>
                  {item.generic_name && (
                    <p className="text-xs text-gray-500 italic pl-5 mt-0.5">
                      {item.generic_name}
                    </p>
                  )}
                  {item.special_instructions && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded inline-block mt-1 ml-5">
                      Note: {item.special_instructions}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  {/* Dosage Pills */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className="px-2 py-1 rounded bg-brand-50 text-brand-800 border border-brand-200">
                      {item.dosage}
                    </span>
                    {item.timing && (
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
                        {item.timing}
                      </span>
                    )}
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
                      {item.duration}
                    </span>
                  </div>

                  {/* Remove Button */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setItemToDelete(item.id)}
                    aria-label="Remove medication"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save current Rx as Template trigger */}
      {items.length > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Name this template (e.g. Viral Fever 3-day)..."
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500"
            />
            <button
              type="button"
              disabled={isSavingTemplate || !newTemplateName.trim()}
              onClick={handleSaveAsTemplate}
              className="min-h-[38px] px-3 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {isSavingTemplate ? "Saving..." : "Save as Protocol Template"}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Remove Medication */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-4">
            <h4 className="text-sm font-bold text-gray-900">Remove Prescribed Medication?</h4>
            <p className="text-xs text-gray-600">
              Are you sure you want to remove this medication from the current prescription?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="min-h-[44px] px-4 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Keep Medication
              </button>
              <button
                type="button"
                onClick={() => handleConfirmRemove(itemToDelete)}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protocol Templates Drawer Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-brand-600" />
                <h4 className="text-sm font-bold text-gray-900">Doctor Protocol Templates</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {savedTemplates.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-xl">
                  No saved templates yet. Save any prescribed set above for instant 1-click application.
                </div>
              ) : (
                savedTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="p-3.5 rounded-lg border border-gray-200 bg-white hover:border-brand-300 transition-colors space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-gray-900">{template.template_name}</h5>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate(template)}
                        className="min-h-[32px] px-3 rounded bg-brand-50 text-brand-700 text-xs font-semibold hover:bg-brand-100 transition-colors"
                      >
                        Apply Template
                      </button>
                    </div>
                    <ul className="text-[11px] text-gray-600 space-y-0.5">
                      {template.items.map((it, idx) => (
                        <li key={idx} className="truncate">
                          • <span className="font-semibold uppercase">{it.medicine_name}</span> ({it.dosage}, {it.duration})
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-gray-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
