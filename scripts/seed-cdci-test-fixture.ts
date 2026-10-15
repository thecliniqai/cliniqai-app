import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// Ensure environment variables are loaded from .env
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(path.resolve(process.cwd(), ".env"));
    }
  } catch {
    // Ignore error if file already loaded or missing
  }
}

import { getAdminClient } from "../tests/helpers/supabase-admin";

export interface TestDrugFixture {
  id: string;
  brand_name: string;
  generic_name: string;
  dose_form: string;
  product_name: string;
  supplier_name: string;
}

export const OPD_TEST_DRUGS: TestDrugFixture[] = [
  // Analgesics & Antipyretics
  { id: "test-cdci-001", brand_name: "Dolo 650", generic_name: "Paracetamol 650 mg", dose_form: "Tablet", product_name: "Dolo", supplier_name: "Micro Labs Ltd" },
  { id: "test-cdci-002", brand_name: "Calpol 500", generic_name: "Paracetamol 500 mg", dose_form: "Tablet", product_name: "Calpol", supplier_name: "GSK India" },
  { id: "test-cdci-003", brand_name: "Calpol 650", generic_name: "Paracetamol 650 mg", dose_form: "Tablet", product_name: "Calpol", supplier_name: "GSK India" },
  { id: "test-cdci-004", brand_name: "Combiflam", generic_name: "Ibuprofen 400 mg + Paracetamol 325 mg", dose_form: "Tablet", product_name: "Combiflam", supplier_name: "Sanofi India" },
  { id: "test-cdci-005", brand_name: "Ibugesic Plus", generic_name: "Ibuprofen 100 mg + Paracetamol 162.5 mg / 5ml", dose_form: "Suspension", product_name: "Ibugesic", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-006", brand_name: "Meftal-Spas", generic_name: "Mefenamic Acid 250 mg + Dicyclomine 10 mg", dose_form: "Tablet", product_name: "Meftal", supplier_name: "Blue Cross Labs" },
  { id: "test-cdci-007", brand_name: "Meftal-P", generic_name: "Mefenamic Acid 100 mg / 5ml", dose_form: "Suspension", product_name: "Meftal", supplier_name: "Blue Cross Labs" },
  { id: "test-cdci-008", brand_name: "Voveran 50", generic_name: "Diclofenac Sodium 50 mg", dose_form: "Tablet", product_name: "Voveran", supplier_name: "Novartis India" },
  { id: "test-cdci-009", brand_name: "Voveran SR 100", generic_name: "Diclofenac Sodium 100 mg", dose_form: "Sustained Release Tablet", product_name: "Voveran", supplier_name: "Novartis India" },
  { id: "test-cdci-010", brand_name: "Zerodol-P", generic_name: "Aceclofenac 100 mg + Paracetamol 325 mg", dose_form: "Tablet", product_name: "Zerodol", supplier_name: "Ipca Laboratories" },
  { id: "test-cdci-011", brand_name: "Zerodol-SP", generic_name: "Aceclofenac 100 mg + Paracetamol 325 mg + Serratiopeptidase 15 mg", dose_form: "Tablet", product_name: "Zerodol", supplier_name: "Ipca Laboratories" },
  { id: "test-cdci-012", brand_name: "Ketorol-DT", generic_name: "Ketorolac Tromethamine 10 mg", dose_form: "Dispersible Tablet", product_name: "Ketorol", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-013", brand_name: "Ultracet", generic_name: "Tramadol 37.5 mg + Paracetamol 325 mg", dose_form: "Tablet", product_name: "Ultracet", supplier_name: "Janssen India" },

  // Antibiotics & Antimicrobials
  { id: "test-cdci-014", brand_name: "Augmentin 625 Duo", generic_name: "Amoxicillin 500 mg + Clavulanic Acid 125 mg", dose_form: "Tablet", product_name: "Augmentin", supplier_name: "GSK India" },
  { id: "test-cdci-015", brand_name: "Augmentin 375", generic_name: "Amoxicillin 250 mg + Clavulanic Acid 125 mg", dose_form: "Tablet", product_name: "Augmentin", supplier_name: "GSK India" },
  { id: "test-cdci-016", brand_name: "Augmentin DDS", generic_name: "Amoxicillin 400 mg + Clavulanic Acid 57 mg / 5ml", dose_form: "Oral Suspension", product_name: "Augmentin", supplier_name: "GSK India" },
  { id: "test-cdci-017", brand_name: "Clavam 625", generic_name: "Amoxicillin 500 mg + Clavulanic Acid 125 mg", dose_form: "Tablet", product_name: "Clavam", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-018", brand_name: "Moxikind-CV 625", generic_name: "Amoxicillin 500 mg + Clavulanic Acid 125 mg", dose_form: "Tablet", product_name: "Moxikind", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-019", brand_name: "Azithral 500", generic_name: "Azithromycin 500 mg", dose_form: "Tablet", product_name: "Azithral", supplier_name: "Alembic Pharmaceuticals" },
  { id: "test-cdci-020", brand_name: "Azithral 250", generic_name: "Azithromycin 250 mg", dose_form: "Tablet", product_name: "Azithral", supplier_name: "Alembic Pharmaceuticals" },
  { id: "test-cdci-021", brand_name: "Azee 500", generic_name: "Azithromycin 500 mg", dose_form: "Tablet", product_name: "Azee", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-022", brand_name: "Taxim-O 200", generic_name: "Cefixime 200 mg", dose_form: "Tablet", product_name: "Taxim-O", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-023", brand_name: "Taxim-O 100 DT", generic_name: "Cefixime 100 mg", dose_form: "Dispersible Tablet", product_name: "Taxim-O", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-024", brand_name: "Zifi 200", generic_name: "Cefixime 200 mg", dose_form: "Tablet", product_name: "Zifi", supplier_name: "FDC Ltd" },
  { id: "test-cdci-025", brand_name: "Cefakind 500", generic_name: "Cefuroxime Axetil 500 mg", dose_form: "Tablet", product_name: "Cefakind", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-026", brand_name: "Ceftum 500", generic_name: "Cefuroxime Axetil 500 mg", dose_form: "Tablet", product_name: "Ceftum", supplier_name: "GSK India" },
  { id: "test-cdci-027", brand_name: "Sporidex 500", generic_name: "Cephalexin 500 mg", dose_form: "Capsule", product_name: "Sporidex", supplier_name: "Sun Pharma" },
  { id: "test-cdci-028", brand_name: "Ciplox 500", generic_name: "Ciprofloxacin 500 mg", dose_form: "Tablet", product_name: "Ciplox", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-029", brand_name: "Cifran 500", generic_name: "Ciprofloxacin 500 mg", dose_form: "Tablet", product_name: "Cifran", supplier_name: "Sun Pharma" },
  { id: "test-cdci-030", brand_name: "Oflox 200", generic_name: "Ofloxacin 200 mg", dose_form: "Tablet", product_name: "Oflox", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-031", brand_name: "Zenflox 200", generic_name: "Ofloxacin 200 mg", dose_form: "Tablet", product_name: "Zenflox", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-032", brand_name: "O2", generic_name: "Ofloxacin 200 mg + Ornidazole 500 mg", dose_form: "Tablet", product_name: "O2", supplier_name: "Medley Pharmaceuticals" },
  { id: "test-cdci-033", brand_name: "Norflox-TZ", generic_name: "Norfloxacin 400 mg + Tinidazole 600 mg", dose_form: "Tablet", product_name: "Norflox-TZ", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-034", brand_name: "Flagyl 400", generic_name: "Metronidazole 400 mg", dose_form: "Tablet", product_name: "Flagyl", supplier_name: "Abbott India" },
  { id: "test-cdci-035", brand_name: "Metrogyl 400", generic_name: "Metronidazole 400 mg", dose_form: "Tablet", product_name: "Metrogyl", supplier_name: "J.B. Chemicals" },
  { id: "test-cdci-036", brand_name: "Doxy-1 L-DR", generic_name: "Doxycycline 100 mg + Lactobacillus", dose_form: "Capsule", product_name: "Doxy-1", supplier_name: "USV Ltd" },
  { id: "test-cdci-037", brand_name: "Septran DS", generic_name: "Trimethoprim 160 mg + Sulfamethoxazole 800 mg", dose_form: "Tablet", product_name: "Septran", supplier_name: "GSK India" },
  { id: "test-cdci-038", brand_name: "Rifaximin 400 (Rifagut)", generic_name: "Rifaximin 400 mg", dose_form: "Tablet", product_name: "Rifagut", supplier_name: "Sun Pharma" },
  { id: "test-cdci-039", brand_name: "Rifagut 550", generic_name: "Rifaximin 550 mg", dose_form: "Tablet", product_name: "Rifagut", supplier_name: "Sun Pharma" },

  // Gastrointestinal & Antacids
  { id: "test-cdci-040", brand_name: "Pan 40", generic_name: "Pantoprazole 40 mg", dose_form: "Tablet", product_name: "Pan", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-041", brand_name: "Pan-D", generic_name: "Pantoprazole 40 mg + Domperidone 30 mg", dose_form: "Capsule", product_name: "Pan-D", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-042", brand_name: "Pantocid 40", generic_name: "Pantoprazole 40 mg", dose_form: "Tablet", product_name: "Pantocid", supplier_name: "Sun Pharma" },
  { id: "test-cdci-043", brand_name: "Pantocid DSR", generic_name: "Pantoprazole 40 mg + Domperidone 30 mg", dose_form: "Capsule", product_name: "Pantocid", supplier_name: "Sun Pharma" },
  { id: "test-cdci-044", brand_name: "Omez 20", generic_name: "Omeprazole 20 mg", dose_form: "Capsule", product_name: "Omez", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-045", brand_name: "Omez-D", generic_name: "Omeprazole 20 mg + Domperidone 10 mg", dose_form: "Capsule", product_name: "Omez", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-046", brand_name: "Razo 20", generic_name: "Rabeprazole 20 mg", dose_form: "Tablet", product_name: "Razo", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-047", brand_name: "Rablet-D", generic_name: "Rabeprazole 20 mg + Domperidone 30 mg", dose_form: "Capsule", product_name: "Rablet", supplier_name: "Lupin Ltd" },
  { id: "test-cdci-048", brand_name: "Nexpro 40", generic_name: "Esomeprazole 40 mg", dose_form: "Tablet", product_name: "Nexpro", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-049", brand_name: "Rantac 150", generic_name: "Ranitidine 150 mg", dose_form: "Tablet", product_name: "Rantac", supplier_name: "J.B. Chemicals" },
  { id: "test-cdci-050", brand_name: "Gelusil MPS", generic_name: "Aluminium Hydroxide + Magnesium Hydroxide + Simethicone", dose_form: "Chewable Tablet", product_name: "Gelusil", supplier_name: "Pfizer India" },
  { id: "test-cdci-051", brand_name: "Digene Gel", generic_name: "Magnesium Hydroxide + Aluminium Hydroxide + Simethicone", dose_form: "Oral Suspension", product_name: "Digene", supplier_name: "Abbott India" },
  { id: "test-cdci-052", brand_name: "Mucaine Gel", generic_name: "Oxetacaine + Aluminium Hydroxide + Magnesium Hydroxide", dose_form: "Oral Suspension", product_name: "Mucaine", supplier_name: "Pfizer India" },
  { id: "test-cdci-053", brand_name: "Sucral-O", generic_name: "Sucralfate 1000 mg + Oxetacaine 20 mg / 10ml", dose_form: "Suspension", product_name: "Sucral", supplier_name: "Strides Pharma" },
  { id: "test-cdci-054", brand_name: "Ondem 4", generic_name: "Ondansetron 4 mg", dose_form: "Tablet", product_name: "Ondem", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-055", brand_name: "Ondem Syrup", generic_name: "Ondansetron 2 mg / 5ml", dose_form: "Syrup", product_name: "Ondem", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-056", brand_name: "Emset 4", generic_name: "Ondansetron 4 mg", dose_form: "Tablet", product_name: "Emset", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-057", brand_name: "Vomikind 4", generic_name: "Ondansetron 4 mg", dose_form: "Tablet", product_name: "Vomikind", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-058", brand_name: "Domstal 10", generic_name: "Domperidone 10 mg", dose_form: "Tablet", product_name: "Domstal", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-059", brand_name: "Econorm Sachet", generic_name: "Saccharomyces boulardii 250 mg", dose_form: "Oral Powder Sachet", product_name: "Econorm", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-060", brand_name: "Enterogermina", generic_name: "Bacillus clausii spores 2 billion", dose_form: "Oral Suspension Vial", product_name: "Enterogermina", supplier_name: "Sanofi India" },
  { id: "test-cdci-061", brand_name: "Darolac", generic_name: "Lactobacillus + Bifidobacterium + Streptococcus", dose_form: "Capsule", product_name: "Darolac", supplier_name: "Aristo Pharmaceuticals" },
  { id: "test-cdci-062", brand_name: "Electral Powder", generic_name: "Oral Rehydration Salts (WHO Formula)", dose_form: "Oral Powder Sachet", product_name: "Electral", supplier_name: "FDC Ltd" },
  { id: "test-cdci-063", brand_name: "Dulcoflex 5", generic_name: "Bisacodyl 5 mg", dose_form: "Tablet", product_name: "Dulcoflex", supplier_name: "Sanofi India" },
  { id: "test-cdci-064", brand_name: "Cremaffin Plus", generic_name: "Liquid Paraffin + Milk of Magnesia + Sodium Picosulfate", dose_form: "Emulsion", product_name: "Cremaffin", supplier_name: "Abbott India" },
  { id: "test-cdci-065", brand_name: "Duphalac", generic_name: "Lactulose 10 g / 15ml", dose_form: "Oral Solution", product_name: "Duphalac", supplier_name: "Abbott India" },
  { id: "test-cdci-066", brand_name: "Lupigut", generic_name: "Lubiprostone 24 mcg", dose_form: "Capsule", product_name: "Lupigut", supplier_name: "Lupin Ltd" },

  // Respiratory & Antiallergic
  { id: "test-cdci-067", brand_name: "Cetzine 10", generic_name: "Cetirizine 10 mg", dose_form: "Tablet", product_name: "Cetzine", supplier_name: "GSK India" },
  { id: "test-cdci-068", brand_name: "Zyrtec 10", generic_name: "Cetirizine 10 mg", dose_form: "Tablet", product_name: "Zyrtec", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-069", brand_name: "Levocet 5", generic_name: "Levocetirizine 5 mg", dose_form: "Tablet", product_name: "Levocet", supplier_name: "Micro Labs Ltd" },
  { id: "test-cdci-070", brand_name: "Montair 10", generic_name: "Montelukast 10 mg", dose_form: "Tablet", product_name: "Montair", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-071", brand_name: "Montair LC", generic_name: "Montelukast 10 mg + Levocetirizine 5 mg", dose_form: "Tablet", product_name: "Montair", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-072", brand_name: "Montair LC Kid", generic_name: "Montelukast 4 mg + Levocetirizine 2.5 mg", dose_form: "Dispersible Tablet", product_name: "Montair", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-073", brand_name: "Allegra 120", generic_name: "Fexofenadine 120 mg", dose_form: "Tablet", product_name: "Allegra", supplier_name: "Sanofi India" },
  { id: "test-cdci-074", brand_name: "Allegra 180", generic_name: "Fexofenadine 180 mg", dose_form: "Tablet", product_name: "Allegra", supplier_name: "Sanofi India" },
  { id: "test-cdci-075", brand_name: "Ascoril-D Plus", generic_name: "Dextromethorphan 10 mg + Chlorpheniramine 2 mg + Phenylephrine 5 mg", dose_form: "Syrup", product_name: "Ascoril", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-076", brand_name: "Ascoril LS", generic_name: "Levosalbutamol 1 mg + Ambroxol 30 mg + Guaiphenesin 50 mg", dose_form: "Syrup", product_name: "Ascoril", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-077", brand_name: "Benadryl Cough Syrup", generic_name: "Diphenhydramine 14.08 mg + Ammonium Chloride 138 mg", dose_form: "Syrup", product_name: "Benadryl", supplier_name: "Johnson & Johnson" },
  { id: "test-cdci-078", brand_name: "Alex Syrup", generic_name: "Dextromethorphan 10 mg + Chlorpheniramine 2 mg + Phenylephrine 5 mg", dose_form: "Syrup", product_name: "Alex", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-079", brand_name: "Grilinctus", generic_name: "Dextromethorphan + Chlorpheniramine + Guaiphenesin + Ammonium Chloride", dose_form: "Syrup", product_name: "Grilinctus", supplier_name: "Franco-Indian" },
  { id: "test-cdci-080", brand_name: "Asthalin Inhaler", generic_name: "Salbutamol 100 mcg / dose", dose_form: "Inhaler (CFC-free)", product_name: "Asthalin", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-081", brand_name: "Asthalin Respules", generic_name: "Salbutamol 2.5 mg / 2.5ml", dose_form: "Respiratory Solution", product_name: "Asthalin", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-082", brand_name: "Budecort 200 Inhaler", generic_name: "Budesonide 200 mcg / dose", dose_form: "Inhaler", product_name: "Budecort", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-083", brand_name: "Budecort 0.5 Respules", generic_name: "Budesonide 0.5 mg / 2ml", dose_form: "Respiratory Solution", product_name: "Budecort", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-084", brand_name: "Duolin Inhaler", generic_name: "Levosalbutamol 50 mcg + Ipratropium 20 mcg", dose_form: "Inhaler", product_name: "Duolin", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-085", brand_name: "Duolin Respules", generic_name: "Levosalbutamol 1.25 mg + Ipratropium 500 mcg", dose_form: "Respiratory Solution", product_name: "Duolin", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-086", brand_name: "Foracort 200", generic_name: "Formoterol 6 mcg + Budesonide 200 mcg", dose_form: "Inhaler / Rotacaps", product_name: "Foracort", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-087", brand_name: "Deriphyllin Retard 150", generic_name: "Etofylline 115 mg + Theophylline 35 mg", dose_form: "Tablet", product_name: "Deriphyllin", supplier_name: "Zydus Healthcare" },

  // Cardiovascular & Antihypertensive
  { id: "test-cdci-088", brand_name: "Telma 40", generic_name: "Telmisartan 40 mg", dose_form: "Tablet", product_name: "Telma", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-089", brand_name: "Telma 80", generic_name: "Telmisartan 80 mg", dose_form: "Tablet", product_name: "Telma", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-090", brand_name: "Telma-H", generic_name: "Telmisartan 40 mg + Hydrochlorothiazide 12.5 mg", dose_form: "Tablet", product_name: "Telma", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-091", brand_name: "Telma-AM", generic_name: "Telmisartan 40 mg + Amlodipine 5 mg", dose_form: "Tablet", product_name: "Telma", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-092", brand_name: "Telpres 40", generic_name: "Telmisartan 40 mg", dose_form: "Tablet", product_name: "Telpres", supplier_name: "Abbott India" },
  { id: "test-cdci-093", brand_name: "Amlokind 5", generic_name: "Amlodipine 5 mg", dose_form: "Tablet", product_name: "Amlokind", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-094", brand_name: "Amlopres 5", generic_name: "Amlodipine 5 mg", dose_form: "Tablet", product_name: "Amlopres", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-095", brand_name: "Cilacar 10", generic_name: "Cilnidipine 10 mg", dose_form: "Tablet", product_name: "Cilacar", supplier_name: "J.B. Chemicals" },
  { id: "test-cdci-096", brand_name: "Cilacar 20", generic_name: "Cilnidipine 20 mg", dose_form: "Tablet", product_name: "Cilacar", supplier_name: "J.B. Chemicals" },
  { id: "test-cdci-097", brand_name: "Envas 5", generic_name: "Enalapril 5 mg", dose_form: "Tablet", product_name: "Envas", supplier_name: "Cadila Pharmaceuticals" },
  { id: "test-cdci-098", brand_name: "Cardace 2.5", generic_name: "Ramipril 2.5 mg", dose_form: "Tablet", product_name: "Cardace", supplier_name: "Sanofi India" },
  { id: "test-cdci-099", brand_name: "Cardace 5", generic_name: "Ramipril 5 mg", dose_form: "Tablet", product_name: "Cardace", supplier_name: "Sanofi India" },
  { id: "test-cdci-100", brand_name: "Betaloc 25", generic_name: "Metoprolol Succinate 25 mg", dose_form: "Extended Release Tablet", product_name: "Betaloc", supplier_name: "AstraZeneca" },
  { id: "test-cdci-101", brand_name: "Betaloc 50", generic_name: "Metoprolol Succinate 50 mg", dose_form: "Extended Release Tablet", product_name: "Betaloc", supplier_name: "AstraZeneca" },
  { id: "test-cdci-102", brand_name: "Nebicard 5", generic_name: "Nebivolol 5 mg", dose_form: "Tablet", product_name: "Nebicard", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-103", brand_name: "Concor 5", generic_name: "Bisoprolol 5 mg", dose_form: "Tablet", product_name: "Concor", supplier_name: "Merck Ltd" },
  { id: "test-cdci-104", brand_name: "Lasix 40", generic_name: "Furosemide 40 mg", dose_form: "Tablet", product_name: "Lasix", supplier_name: "Sanofi India" },
  { id: "test-cdci-105", brand_name: "Dytor 10", generic_name: "Torsemide 10 mg", dose_form: "Tablet", product_name: "Dytor", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-106", brand_name: "Dytor Plus 10", generic_name: "Torsemide 10 mg + Spironolactone 50 mg", dose_form: "Tablet", product_name: "Dytor", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-107", brand_name: "Aldactone 25", generic_name: "Spironolactone 25 mg", dose_form: "Tablet", product_name: "Aldactone", supplier_name: "RPG Life Sciences" },
  { id: "test-cdci-108", brand_name: "Ecosprin 75", generic_name: "Aspirin 75 mg", dose_form: "Enteric Coated Tablet", product_name: "Ecosprin", supplier_name: "USV Ltd" },
  { id: "test-cdci-109", brand_name: "Ecosprin 150", generic_name: "Aspirin 150 mg", dose_form: "Enteric Coated Tablet", product_name: "Ecosprin", supplier_name: "USV Ltd" },
  { id: "test-cdci-110", brand_name: "Ecosprin-AV 75", generic_name: "Aspirin 75 mg + Atorvastatin 10 mg", dose_form: "Capsule", product_name: "Ecosprin", supplier_name: "USV Ltd" },
  { id: "test-cdci-111", brand_name: "Atorva 10", generic_name: "Atorvastatin 10 mg", dose_form: "Tablet", product_name: "Atorva", supplier_name: "Zydus Healthcare" },
  { id: "test-cdci-112", brand_name: "Atorva 20", generic_name: "Atorvastatin 20 mg", dose_form: "Tablet", product_name: "Atorva", supplier_name: "Zydus Healthcare" },
  { id: "test-cdci-113", brand_name: "Rosuvas 10", generic_name: "Rosuvastatin 10 mg", dose_form: "Tablet", product_name: "Rosuvas", supplier_name: "Sun Pharma" },
  { id: "test-cdci-114", brand_name: "Rosuvas 20", generic_name: "Rosuvastatin 20 mg", dose_form: "Tablet", product_name: "Rosuvas", supplier_name: "Sun Pharma" },

  // Antidiabetic
  { id: "test-cdci-115", brand_name: "Glycomet 500", generic_name: "Metformin 500 mg", dose_form: "Tablet", product_name: "Glycomet", supplier_name: "USV Ltd" },
  { id: "test-cdci-116", brand_name: "Glycomet 1000 SR", generic_name: "Metformin 1000 mg", dose_form: "Sustained Release Tablet", product_name: "Glycomet", supplier_name: "USV Ltd" },
  { id: "test-cdci-117", brand_name: "Glycomet-GP 1", generic_name: "Glimepiride 1 mg + Metformin 500 mg", dose_form: "Tablet", product_name: "Glycomet", supplier_name: "USV Ltd" },
  { id: "test-cdci-118", brand_name: "Glycomet-GP 2", generic_name: "Glimepiride 2 mg + Metformin 500 mg", dose_form: "Tablet", product_name: "Glycomet", supplier_name: "USV Ltd" },
  { id: "test-cdci-119", brand_name: "Amaryl 1", generic_name: "Glimepiride 1 mg", dose_form: "Tablet", product_name: "Amaryl", supplier_name: "Sanofi India" },
  { id: "test-cdci-120", brand_name: "Amaryl 2", generic_name: "Glimepiride 2 mg", dose_form: "Tablet", product_name: "Amaryl", supplier_name: "Sanofi India" },
  { id: "test-cdci-121", brand_name: "Januvia 100", generic_name: "Sitagliptin 100 mg", dose_form: "Tablet", product_name: "Januvia", supplier_name: "MSD India" },
  { id: "test-cdci-122", brand_name: "Janumet 50/500", generic_name: "Sitagliptin 50 mg + Metformin 500 mg", dose_form: "Tablet", product_name: "Janumet", supplier_name: "MSD India" },
  { id: "test-cdci-123", brand_name: "Galvus 50", generic_name: "Vildagliptin 50 mg", dose_form: "Tablet", product_name: "Galvus", supplier_name: "Novartis India" },
  { id: "test-cdci-124", brand_name: "Galvus Met 50/500", generic_name: "Vildagliptin 50 mg + Metformin 500 mg", dose_form: "Tablet", product_name: "Galvus", supplier_name: "Novartis India" },
  { id: "test-cdci-125", brand_name: "Trajenta 5", generic_name: "Linagliptin 5 mg", dose_form: "Tablet", product_name: "Trajenta", supplier_name: "Boehringer Ingelheim" },
  { id: "test-cdci-126", brand_name: "Jardiance 10", generic_name: "Empagliflozin 10 mg", dose_form: "Tablet", product_name: "Jardiance", supplier_name: "Boehringer Ingelheim" },
  { id: "test-cdci-127", brand_name: "Jardiance 25", generic_name: "Empagliflozin 25 mg", dose_form: "Tablet", product_name: "Jardiance", supplier_name: "Boehringer Ingelheim" },
  { id: "test-cdci-128", brand_name: "Forxiga 10", generic_name: "Dapagliflozin 10 mg", dose_form: "Tablet", product_name: "Forxiga", supplier_name: "AstraZeneca" },
  { id: "test-cdci-129", brand_name: "Oxra 10", generic_name: "Dapagliflozin 10 mg", dose_form: "Tablet", product_name: "Oxra", supplier_name: "Sun Pharma" },
  { id: "test-cdci-130", brand_name: "Rybelsus 3", generic_name: "Oral Semaglutide 3 mg", dose_form: "Tablet", product_name: "Rybelsus", supplier_name: "Novo Nordisk" },
  { id: "test-cdci-131", brand_name: "Rybelsus 7", generic_name: "Oral Semaglutide 7 mg", dose_form: "Tablet", product_name: "Rybelsus", supplier_name: "Novo Nordisk" },
  { id: "test-cdci-132", brand_name: "Human Mixtard 30/70", generic_name: "Biphasic Isophane Insulin 100 IU/ml", dose_form: "Injection Vial", product_name: "Mixtard", supplier_name: "Novo Nordisk" },
  { id: "test-cdci-133", brand_name: "Lantus SoloStar", generic_name: "Insulin Glargine 100 IU/ml", dose_form: "Pre-filled Pen", product_name: "Lantus", supplier_name: "Sanofi India" },

  // Vitamins, Minerals & Supplements
  { id: "test-cdci-134", brand_name: "Shelcal 500", generic_name: "Calcium Carbonate 1250 mg (eq. to Elemental Calcium 500 mg) + Vitamin D3 250 IU", dose_form: "Tablet", product_name: "Shelcal", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-135", brand_name: "Shelcal HD", generic_name: "Calcium 500 mg + Vitamin D3 500 IU", dose_form: "Tablet", product_name: "Shelcal", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-136", brand_name: "Becosules", generic_name: "Vitamin B Complex + Vitamin C", dose_form: "Capsule", product_name: "Becosules", supplier_name: "Pfizer India" },
  { id: "test-cdci-137", brand_name: "Neurobion Forte", generic_name: "Vitamin B1 + B2 + B3 + B5 + B6 + B12", dose_form: "Tablet", product_name: "Neurobion", supplier_name: "Procter & Gamble Health" },
  { id: "test-cdci-138", brand_name: "Optineuron", generic_name: "Vitamin B Complex", dose_form: "Injection", product_name: "Optineuron", supplier_name: "Lupin Ltd" },
  { id: "test-cdci-139", brand_name: "Supradyn Daily", generic_name: "Multivitamin + Multimineral with Trace Elements", dose_form: "Tablet", product_name: "Supradyn", supplier_name: "Bayer Pharmaceuticals" },
  { id: "test-cdci-140", brand_name: "Autrin", generic_name: "Ferrous Fumarate + Folic Acid + Vitamin B12", dose_form: "Capsule", product_name: "Autrin", supplier_name: "Pfizer India" },
  { id: "test-cdci-141", brand_name: "Orofer-XT", generic_name: "Ferrous Ascorbate 100 mg + Folic Acid 1.5 mg", dose_form: "Tablet", product_name: "Orofer", supplier_name: "Emcure Pharmaceuticals" },
  { id: "test-cdci-142", brand_name: "Folvite 5", generic_name: "Folic Acid 5 mg", dose_form: "Tablet", product_name: "Folvite", supplier_name: "Pfizer India" },
  { id: "test-cdci-143", brand_name: "Uprise-D3 60K", generic_name: "Cholecalciferol (Vitamin D3) 60,000 IU", dose_form: "Soft Gel Capsule", product_name: "Uprise", supplier_name: "Alkem Laboratories" },
  { id: "test-cdci-144", brand_name: "Calcirol Sachet", generic_name: "Cholecalciferol 60,000 IU", dose_form: "Oral Granules Sachet", product_name: "Calcirol", supplier_name: "Cadila Pharmaceuticals" },
  { id: "test-cdci-145", brand_name: "Limcee 500", generic_name: "Vitamin C (Ascorbic Acid) 500 mg", dose_form: "Chewable Tablet", product_name: "Limcee", supplier_name: "Abbott India" },
  { id: "test-cdci-146", brand_name: "Celin 500", generic_name: "Vitamin C 500 mg", dose_form: "Chewable Tablet", product_name: "Celin", supplier_name: "Koye Pharmaceuticals" },
  { id: "test-cdci-147", brand_name: "Evion 400", generic_name: "Vitamin E (Tocopherol) 400 mg", dose_form: "Capsule", product_name: "Evion", supplier_name: "Procter & Gamble Health" },
  { id: "test-cdci-148", brand_name: "Zinconia 50", generic_name: "Zinc Acetate 50 mg", dose_form: "Tablet", product_name: "Zinconia", supplier_name: "Zuventus Healthcare" },

  // Thyroid & Endocrine
  { id: "test-cdci-149", brand_name: "Thyronorm 25", generic_name: "Levothyroxine Sodium 25 mcg", dose_form: "Tablet", product_name: "Thyronorm", supplier_name: "Abbott India" },
  { id: "test-cdci-150", brand_name: "Thyronorm 50", generic_name: "Levothyroxine Sodium 50 mcg", dose_form: "Tablet", product_name: "Thyronorm", supplier_name: "Abbott India" },
  { id: "test-cdci-151", brand_name: "Thyronorm 75", generic_name: "Levothyroxine Sodium 75 mcg", dose_form: "Tablet", product_name: "Thyronorm", supplier_name: "Abbott India" },
  { id: "test-cdci-152", brand_name: "Thyronorm 100", generic_name: "Levothyroxine Sodium 100 mcg", dose_form: "Tablet", product_name: "Thyronorm", supplier_name: "Abbott India" },
  { id: "test-cdci-153", brand_name: "Eltroxin 50", generic_name: "Levothyroxine 50 mcg", dose_form: "Tablet", product_name: "Eltroxin", supplier_name: "GSK India" },

  // Dental & Oral Health
  { id: "test-cdci-154", brand_name: "Kenacort 0.1% Oral Paste", generic_name: "Triamcinolone Acetonide 0.1%", dose_form: "Dental Paste", product_name: "Kenacort", supplier_name: "Abbott India" },
  { id: "test-cdci-155", brand_name: "Mucopain Gel", generic_name: "Benzocaine 20%", dose_form: "Oral Gel", product_name: "Mucopain", supplier_name: "ICPA Health Products" },
  { id: "test-cdci-156", brand_name: "Clohex Mouthwash", generic_name: "Chlorhexidine Gluconate 0.2%", dose_form: "Mouthwash", product_name: "Clohex", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-157", brand_name: "Hexidine Mouthwash", generic_name: "Chlorhexidine Gluconate 0.2%", dose_form: "Mouthwash", product_name: "Hexidine", supplier_name: "ICPA Health Products" },
  { id: "test-cdci-158", brand_name: "Sensodyne Rapid Relief", generic_name: "Strontium Acetate + Sodium Fluoride", dose_form: "Dentifrice Toothpaste", product_name: "Sensodyne", supplier_name: "GSK Consumer" },
  { id: "test-cdci-159", brand_name: "Thermoseal Toothpaste", generic_name: "Potassium Nitrate + Sodium Monofluorophosphate", dose_form: "Dentifrice Toothpaste", product_name: "Thermoseal", supplier_name: "ICPA Health Products" },
  { id: "test-cdci-160", brand_name: "Stolin Gum Paint", generic_name: "Tannic Acid + Zinc Chloride + Cetrimide", dose_form: "Gum Paint", product_name: "Stolin", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-161", brand_name: "Dologel", generic_name: "Choline Salicylate + Lidocaine", dose_form: "Oral Gel", product_name: "Dologel", supplier_name: "Dr Reddy's" },
  { id: "test-cdci-162", brand_name: "Ora-Sore Gel", generic_name: "Tannic Acid + Choline Salicylate + Cetrimide + Lignocaine", dose_form: "Gel", product_name: "Ora-Sore", supplier_name: "Wings Biotech" },

  // Topical & Dermatological
  { id: "test-cdci-163", brand_name: "Betadine 10% Ointment", generic_name: "Povidone Iodine 10% w/w", dose_form: "Ointment", product_name: "Betadine", supplier_name: "Win-Medicare" },
  { id: "test-cdci-164", brand_name: "Betadine Gargle 2%", generic_name: "Povidone Iodine 2% w/v", dose_form: "Gargle Solution", product_name: "Betadine", supplier_name: "Win-Medicare" },
  { id: "test-cdci-165", brand_name: "Soframycin Cream", generic_name: "Framycetin Sulphate 1% w/w", dose_form: "Skin Cream", product_name: "Soframycin", supplier_name: "Sanofi India" },
  { id: "test-cdci-166", brand_name: "T-Bact Ointment", generic_name: "Mupirocin 2% w/w", dose_form: "Ointment", product_name: "T-Bact", supplier_name: "GSK India" },
  { id: "test-cdci-167", brand_name: "Bactroban Ointment", generic_name: "Mupirocin 2% w/w", dose_form: "Ointment", product_name: "Bactroban", supplier_name: "GSK India" },
  { id: "test-cdci-168", brand_name: "Candid Powder", generic_name: "Clotrimazole 1% w/w", dose_form: "Topical Powder", product_name: "Candid", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-169", brand_name: "Candid-B Cream", generic_name: "Clotrimazole 1% + Beclomethasone Dipropionate 0.025%", dose_form: "Skin Cream", product_name: "Candid", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-170", brand_name: "Quadriderm RF Cream", generic_name: "Beclomethasone + Clotrimazole + Neomycin", dose_form: "Skin Cream", product_name: "Quadriderm", supplier_name: "Fulford India" },
  { id: "test-cdci-171", brand_name: "Betnovate-N", generic_name: "Betamethasone Valerate 0.1% + Neomycin Sulphate 0.5%", dose_form: "Skin Cream", product_name: "Betnovate", supplier_name: "GSK India" },
  { id: "test-cdci-172", brand_name: "Betnovate-C", generic_name: "Betamethasone Valerate 0.1% + Clioquinol 3%", dose_form: "Skin Cream", product_name: "Betnovate", supplier_name: "GSK India" },
  { id: "test-cdci-173", brand_name: "Clobetamil-G", generic_name: "Clobetasol Propionate 0.05% + Gentamicin 0.1%", dose_form: "Skin Cream", product_name: "Clobetamil", supplier_name: "Cosme Farma" },
  { id: "test-cdci-174", brand_name: "Tenovate Cream", generic_name: "Clobetasol Propionate 0.05%", dose_form: "Skin Cream", product_name: "Tenovate", supplier_name: "GSK India" },
  { id: "test-cdci-175", brand_name: "Elocon Cream", generic_name: "Mometasone Furoate 0.1%", dose_form: "Skin Cream", product_name: "Elocon", supplier_name: "Fulford India" },
  { id: "test-cdci-176", brand_name: "Burnol", generic_name: "Aminacrine HCl + Cetrimide", dose_form: "Skin Cream", product_name: "Burnol", supplier_name: "Morepen Laboratories" },
  { id: "test-cdci-177", brand_name: "Silverex Ionic Gel", generic_name: "Silver Nitrate + Chlorhexidine", dose_form: "Gel", product_name: "Silverex", supplier_name: "Sun Pharma" },

  // Ophthalmic & ENT Drops
  { id: "test-cdci-178", brand_name: "Ciplox Eye/Ear Drops", generic_name: "Ciprofloxacin 0.3% w/v", dose_form: "Eye/Ear Drops", product_name: "Ciplox", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-179", brand_name: "Tobramycin Drops (Tobrex)", generic_name: "Tobramycin 0.3%", dose_form: "Eye Drops", product_name: "Tobrex", supplier_name: "Novartis India" },
  { id: "test-cdci-180", brand_name: "Moxicip Eye Drops", generic_name: "Moxifloxacin 0.5% w/v", dose_form: "Eye Drops", product_name: "Moxicip", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-181", brand_name: "Vigamox Eye Drops", generic_name: "Moxifloxacin 0.5%", dose_form: "Eye Drops", product_name: "Vigamox", supplier_name: "Alcon India" },
  { id: "test-cdci-182", brand_name: "Refresh Tears", generic_name: "Carboxymethylcellulose 0.5%", dose_form: "Lubricant Eye Drops", product_name: "Refresh", supplier_name: "Allergan India" },
  { id: "test-cdci-183", brand_name: "Otrivin Adult Nasal Spray", generic_name: "Xylometazoline Hydrochloride 0.1% w/v", dose_form: "Nasal Spray", product_name: "Otrivin", supplier_name: "GSK Consumer" },
  { id: "test-cdci-184", brand_name: "Otrivin Paediatric Nasal Drops", generic_name: "Xylometazoline Hydrochloride 0.05% w/v", dose_form: "Nasal Drops", product_name: "Otrivin", supplier_name: "GSK Consumer" },
  { id: "test-cdci-185", brand_name: "Nasivion Adult Nasal Spray", generic_name: "Oxymetazoline Hydrochloride 0.05%", dose_form: "Nasal Spray", product_name: "Nasivion", supplier_name: "Procter & Gamble Health" },
  { id: "test-cdci-186", brand_name: "Waxsol Ear Drops", generic_name: "Docusate Sodium 0.5%", dose_form: "Ear Drops", product_name: "Waxsol", supplier_name: "Pfizer India" },
  { id: "test-cdci-187", brand_name: "Clearwax Ear Drops", generic_name: "Paradichlorobenzene + Benzocaine + Chlorbutol + Turpentine Oil", dose_form: "Ear Drops", product_name: "Clearwax", supplier_name: "Cipla Ltd" },

  // Central Nervous System & Psychiatric
  { id: "test-cdci-188", brand_name: "Nexito 10", generic_name: "Escitalopram 10 mg", dose_form: "Tablet", product_name: "Nexito", supplier_name: "Sun Pharma" },
  { id: "test-cdci-189", brand_name: "Nexito Plus", generic_name: "Escitalopram 5 mg + Clonazepam 0.5 mg", dose_form: "Tablet", product_name: "Nexito", supplier_name: "Sun Pharma" },
  { id: "test-cdci-190", brand_name: "Clonafit 0.5", generic_name: "Clonazepam 0.5 mg", dose_form: "Tablet", product_name: "Clonafit", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-191", brand_name: "Alprax 0.25", generic_name: "Alprazolam 0.25 mg", dose_form: "Tablet", product_name: "Alprax", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-192", brand_name: "Alprax 0.5", generic_name: "Alprazolam 0.5 mg", dose_form: "Tablet", product_name: "Alprax", supplier_name: "Torrent Pharmaceuticals" },
  { id: "test-cdci-193", brand_name: "Stugeron 25", generic_name: "Cinnarizine 25 mg", dose_form: "Tablet", product_name: "Stugeron", supplier_name: "Janssen India" },
  { id: "test-cdci-194", brand_name: "Vertin 16", generic_name: "Betahistine 16 mg", dose_form: "Tablet", product_name: "Vertin", supplier_name: "Abbott India" },
  { id: "test-cdci-195", brand_name: "Sibelium 10", generic_name: "Flunarizine 10 mg", dose_form: "Tablet", product_name: "Sibelium", supplier_name: "Janssen India" },

  // Anthelmintic & Antifungal
  { id: "test-cdci-196", brand_name: "Zentel 400", generic_name: "Albendazole 400 mg", dose_form: "Chewable Tablet", product_name: "Zentel", supplier_name: "GSK India" },
  { id: "test-cdci-197", brand_name: "Bandey Plus", generic_name: "Ivermectin 6 mg + Albendazole 400 mg", dose_form: "Chewable Tablet", product_name: "Bandey", supplier_name: "Mankind Pharma" },
  { id: "test-cdci-198", brand_name: "Flucon 150", generic_name: "Fluconazole 150 mg", dose_form: "Tablet", product_name: "Flucon", supplier_name: "Cipla Ltd" },
  { id: "test-cdci-199", brand_name: "Canditral 100", generic_name: "Itraconazole 100 mg", dose_form: "Capsule", product_name: "Canditral", supplier_name: "Glenmark Pharmaceuticals" },
  { id: "test-cdci-200", brand_name: "Canditral 200", generic_name: "Itraconazole 200 mg", dose_form: "Capsule", product_name: "Canditral", supplier_name: "Glenmark Pharmaceuticals" },
];

export async function seedCdciTestFixture(clientOverride?: SupabaseClient<Database>) {
  const supabase = clientOverride || getAdminClient();

  const records: Database["public"]["Tables"]["cdci_medicines_search"]["Insert"][] = OPD_TEST_DRUGS.map((d) => ({
    id: d.id,
    brand_name: d.brand_name,
    product_name: d.product_name,
    generic_name: d.generic_name,
    dose_form: d.dose_form,
    route: null,
    supplier_name: d.supplier_name,
  }));

  const startTime = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("cdci_medicines_search").upsert(records, {
    onConflict: "id",
  });

  if (error) {
    throw new Error(`Failed to seed CDCI test fixture: ${error.message}`);
  }

  const duration = Date.now() - startTime;
  console.log(`✓ Seeded ${records.length} OPD drugs fixture in ${duration}ms`);
}

if (typeof require !== "undefined" && require.main === module) {
  seedCdciTestFixture().catch((err) => {
    console.error("Test fixture seed failed:", err);
    process.exit(1);
  });
}
