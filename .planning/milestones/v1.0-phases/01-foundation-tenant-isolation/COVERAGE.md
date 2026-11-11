No external API integration: Phase 1 (Foundation & Tenant Isolation) builds against first-party infrastructure only — Supabase Auth (OTP/invite delivery), Supabase PostgREST + Row Level Security, and the Supabase CLI — all of which AGENTS.md §5 designates as the application's own database/backend platform rather than a third-party API or SDK. No vendor SDK, REST/GraphQL client, payment gateway, messaging provider, ABDM/ABHA service, HFR/HPR registry, FHIR server, or AI provider is called anywhere in this phase.

## Surfaces considered (and why none is an external integration)

- **Supabase Auth OTP / invitation delivery.** First-party platform capability (auth + built-in email). Phase 1 deliberately integrates no email, SMS, or WhatsApp provider: the Plan 03 invite flow hands delivery to Supabase Auth, and Plans 02–05 send nothing from application code. Provider-based delivery is deferred to the notifications phase (Phase 5).
- **Supabase PostgREST + RLS.** The application's own data plane, reached through `@supabase/ssr` clients under our control; not an external service surface.
- **Supabase CLI (`npx supabase db push`, `migration list`).** Local/devDependency tooling pinned in the project, used by the Plan 05 blocking schema gate.
- **ABHA / ABDM.** Phase 1 stores an optional, nullable ABHA identifier entered by a human. No ABDM API is called and no ABHA format validation is enforced — live integration is a later phase (see ROADMAP Phase 2 and the Plan 04 compliance note).
- **HFR / HPR registries.** Plan 04 adds nullable identifier columns only (forward-compatible storage). No registry call, no lookup, no sync.
- **FHIR / health-information exchange.** `docs/compliance-data-layer.md` documents an *intended* field mapping (Patient, Encounter, MedicationRequest, Condition) and explicitly claims no live interoperability. No FHIR server is contacted; no code-system service (e.g. ICD-10 or drug-code lookup) is called.
- **Payment gateway.** Plan 03 records subscription and payment history as rows readable by Owner/Admin (₹1,000/month standard plan). No gateway SDK, no checkout, no webhook, no tokenized card data. Tenant billing/payments is a later phase; platform subscription collection is out of Phase 1 scope.
- **AI provider.** Phase 1 ships no AI-assisted feature, so no model/vendor is contacted.

## Note for the seal gate

The detector's signal for this phase (`verb: "(surface)", noun: "api"`) comes from prose in the plans that names the phrase "API" while discussing Supabase platform boundaries (for example the Next.js Server Action / PostgREST boundary in the Plan 02 threat model) — not from an external integration. This declaration is the reasoned overrule; it is not a bypass, and it should be revisited if any later phase introduces a real third-party surface.
