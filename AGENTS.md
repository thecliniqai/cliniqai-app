# AGENTS.md — Clinic SaaS Engineering Constitution

> **Purpose:** Persistent engineering instructions for OpenCode working on this repository.
>
> This file defines architecture, technology choices, engineering quality standards, security rules, testing expectations, and delivery practices for the clinic SaaS application.
>
> **UI/UX authority:** `DESIGN.md` is the single source of truth for all visual and interaction design. Read it before creating or modifying any UI.

---

# 1. Mission

Build a production-grade, multi-tenant clinic SaaS application for small and mid-sized clinics.

The product must optimize for:

- simplicity
- speed of daily clinic operations
- reliability
- security
- maintainability
- accessibility
- clear information hierarchy
- excellent UX
- predictable behaviour

Do not equate "production grade" with "over-engineered".

Prefer a well-structured modular monolith over premature microservices.

> **Simple architecture, strong boundaries, high-quality implementation.**

---

# 2. Instruction Priority

When making decisions, use this priority:

1. Explicit user/task requirements.
2. `AGENTS.md` for engineering, architecture, security, testing, and delivery rules.
3. `DESIGN.md` for all UI/UX and visual decisions.
4. Existing project conventions that are consistent with the above.
5. Framework/library defaults.
6. General coding-agent preferences.

When instructions conflict:

- `DESIGN.md` wins for UI/UX.
- `AGENTS.md` wins for architecture/engineering.
- Do not silently override explicit project decisions.
- Ask only when the ambiguity materially affects correctness or architecture; otherwise make the smallest reasonable change.

---

# 3. Mandatory UI/UX Rule

## `DESIGN.md` is the canonical design authority.

Before touching any frontend UI:

- Read `DESIGN.md`.
- Reuse its tokens and component rules.
- Reuse existing components before creating new ones.
- Follow its light-only theme.
- Follow its typography, spacing, radius, color, state, accessibility, and interaction rules.
- Do not introduce an alternative design system.

### Never do this

- Do not introduce dark mode.
- Do not add dark UI shells.
- Do not add gradients unless explicitly requested.
- Do not invent arbitrary brand colors.
- Do not use arbitrary Tailwind/default framework colors as product colors.
- Do not create a second spacing scale.
- Do not create a second typography scale.
- Do not use a UI library's default appearance without adapting it to `DESIGN.md`.
- Do not add cards simply because a component library provides a card component.
- Do not make every action a pill.
- Do not introduce decorative UI solely to make a screen look "fancier".
- Do not create an isolated UI pattern when an existing product pattern can be reused.

### UI acceptance test

Before considering a UI task complete, verify:

- It looks like the same product as the rest of the application.
- It follows `DESIGN.md`.
- It works at desktop and mobile breakpoints.
- Keyboard navigation works.
- Focus states are visible.
- Errors are understandable.
- Loading and empty states are handled.
- Status meaning does not depend only on color.
- Primary action hierarchy is clear.

---

# 4. Product Principles

Every feature should satisfy these principles.

## 4.1 Minimize cognitive load

Prefer:

- sensible defaults
- inline editing where appropriate
- progressive disclosure
- autocomplete/search for long lists
- contextual actions
- clear confirmation only when consequences justify it

Avoid:

- unnecessary multi-step forms
- repeated data entry
- unnecessary confirmation dialogs
- exposing implementation details
- requiring users to remember values already known by the system

## 4.2 Optimize common workflows first

Common workflows should be extremely fast:

- search patient
- register patient
- book appointment
- check in patient
- start consultation
- add diagnosis
- create prescription
- record payment
- view previous visit
- schedule follow-up

Do not optimize rare administrative workflows at the expense of daily clinical workflows.

## 4.3 Prefer progressive disclosure

Show what is necessary now.

Move advanced functionality into:

- drawers
- expandable sections
- secondary tabs
- overflow actions
- advanced settings

---

# 5. Technology Stack

This is the preferred production stack unless the repository already contains a justified equivalent.

## Frontend

- **Next.js — latest stable version (`next@latest`)**
- React — latest version compatible with the selected Next.js release
- TypeScript — strict mode
- Next.js **App Router**
- Turbopack where supported by the current Next.js release
- TanStack Query where client-side server-state management is genuinely useful
- Zustand only for small, shared client-side state where React state/context is insufficient
- React Hook Form for complex forms
- Zod for runtime validation and form schemas
- Tailwind CSS may be used as the styling engine, but **design tokens and component styling must come from `DESIGN.md`**
- Radix UI primitives may be used for accessible low-level interactions
- Lucide icons for the default icon set

### Frontend rules

- **Do not use Vite as the application framework.**
- **Do not use React Router as the primary application router.** Use Next.js App Router.
- Use Server Components by default where they simplify data fetching and reduce client-side JavaScript.
- Use Client Components only where interactivity, browser APIs, or client state require them.
- Use Server Actions / Route Handlers / other current Next.js server primitives where they are appropriate.
- Keep business logic out of presentation components.
- Avoid global mutable state.
- Prefer typed service/data-access functions over ad-hoc fetch logic scattered across components.
- Avoid unnecessary abstraction layers.
- Follow current Next.js official patterns rather than old Pages Router conventions.
- Keep the project upgradeable: do not pin to obsolete framework APIs when a stable current equivalent exists.

## Database & Backend Platform

### Current source of truth

**Supabase is the application's database/backend platform.**

Use Supabase for:

- Database
- Authentication
- Row Level Security
- Storage
- Realtime where actually required

The application should interact with Supabase through its supported client/server libraries and a small internal data-access layer. Supabase's current Next.js guidance uses the Next.js App Router and `@supabase/ssr` for cookie-based SSR authentication. citeturn844443search0turn844443search1turn844443search7

### Supabase rules

- Use the official Supabase packages appropriate to the current Next.js architecture.
- For SSR/cookie sessions, prefer `@supabase/ssr` according to current Supabase guidance.
- Keep Supabase access centralized in `lib/supabase/` and feature-level data-access/service modules.
- Generate and use typed database definitions where practical.
- Treat **Row Level Security (RLS) as a mandatory security boundary**, not an optional convenience.
- Every tenant-owned table must have deliberate RLS policies.
- Never depend solely on frontend filtering for tenant isolation.
- Never expose service-role credentials to the browser.
- Keep database access and business rules behind application boundaries so the domain layer does not become tightly coupled to Supabase-specific APIs.

### No local SQLite requirement

- **Do not use SQLite as the application database.**
- Do not design business logic around SQLite-specific behaviour.
- Local development should use the actual Supabase development project/environment wherever practical.
- Automated tests should prefer isolated Supabase/Postgres test environments or mocks/fakes at the repository boundary rather than introducing a second production-like database technology.

### No direct database-platform coupling

Do not treat a raw Postgres connection as the application's primary data-access interface just because Supabase uses Postgres underneath.

The product is intentionally choosing **Supabase as the platform**, not "self-managed Postgres".

Keep provider-specific code behind clear boundaries so a future provider migration is possible without rewriting the domain layer.

### Future portability / Alchemy

If the project later needs to move away from Supabase, evaluate **Alchemy** as the infrastructure/deployment layer for provisioning and managing the replacement database/infrastructure, while preserving the application's domain and repository/service interfaces.

Do not introduce Alchemy into the current codebase merely for theoretical portability.

When a migration is actually approved:

1. keep domain/application logic provider-agnostic;
2. implement the replacement data provider behind the existing data-access boundary;
3. use Alchemy where it materially simplifies provisioning, migrations, or infrastructure lifecycle;
4. migrate data with an explicit, tested migration plan;
5. remove Supabase-specific dependencies only after the replacement is verified.

> Note: Alchemy is primarily an Infrastructure-as-Code / SQL orchestration tool and can work with Postgres/Drizzle; it is not a drop-in "Supabase compatibility layer." Treat it as a future infrastructure option, not as today's database abstraction. citeturn520351search2turn520351search6

## Backend

Prefer **Next.js server capabilities** for the application backend by default:

- Server Components for server-rendered data access where appropriate
- Server Actions for appropriate application mutations
- Route Handlers for API endpoints/integrations
- Next.js server utilities for backend-only logic

Do not introduce a separate Python/FastAPI backend unless a concrete requirement justifies it, such as:

- workloads that materially benefit from Python
- specialized data/ML processing
- long-running workers
- an independently deployable service
- an integration that requires a Python-specific ecosystem

If such a service is introduced later, keep it modular and behind explicit contracts.

### Backend rules

- Keep request paths fast and predictable.
- Validate all external input.
- Keep business rules out of route handlers where that would create large handlers.
- Use typed request/response contracts.
- Transactions must be explicit for multi-step state changes.
- Do not perform slow external calls synchronously when a background job is appropriate.

## Infrastructure

Preferred baseline:

- **Vercel** for the Next.js application
- **Supabase** for database/auth/storage/realtime
- Vercel environment variables for application secrets/configuration
- Supabase managed backups / recovery capabilities as appropriate to the selected plan
- GitHub-based CI/CD
- HTTPS everywhere outside local development

Use Docker only when it provides a concrete benefit for a separate service, worker, local dependency, or deployment target.

Do not introduce Kubernetes unless explicitly required.

---

# 6. Architecture

## 6.1 Start as a modular monolith

Keep the application logically modular without prematurely splitting into microservices.

Recommended modules:

- Auth / Identity
- Tenants / Clinics
- Users / Staff
- Patients
- Appointments
- Check-in / Queue
- Consultations
- Prescriptions
- Lab Reports
- Referrals
- Billing / Payments
- Notifications
- Documents
- Reports / Analytics
- Audit
- Settings

Each module should have clear ownership of:

- domain models
- business rules
- API handlers
- persistence access
- validation
- tests

Cross-module dependencies must be intentional.

## 6.2 Suggested repository structure

Adapt to the existing repository if it already has a strong structure.

```text
/
├── AGENTS.md
├── DESIGN.md
├── README.md
├── .env.example
├── docker-compose.yml
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   └── tests/
│   ├── api/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── core/
│   │   │   ├── db/
│   │   │   ├── modules/
│   │   │   ├── services/
│   │   │   └── main.py
│   │   └── tests/
│   └── worker/
├── packages/
│   └── contracts/
├── migrations/
├── docs/
└── infra/
```

Do not reorganize an existing codebase solely to match this example.

---

# 7. Multi-Tenancy

Multi-tenancy is a first-class architecture concern.

The clinic/tenant boundary must be enforced server-side.

Every tenant-owned entity must have an unambiguous tenant relationship.

Examples:

- patient belongs to clinic
- appointment belongs to clinic
- consultation belongs to clinic
- invoice belongs to clinic
- document belongs to clinic

### Mandatory rules

- Never trust tenant IDs supplied by the browser.
- Derive tenant context from authenticated identity/session and authorized membership.
- Every tenant-scoped database query must apply tenant isolation.
- Test cross-tenant access explicitly.
- Never expose one tenant's data through:
  - IDs
  - search
  - filtering
  - autocomplete
  - exports
  - reports
  - file URLs
  - background jobs

### Do not

- rely on frontend filtering for tenant isolation
- assume UUIDs alone provide tenant security
- create "admin bypass" logic without explicit authorization checks

---

# 8. Identity, Authentication & Authorization

Use secure, server-controlled authentication.

Preferred web pattern:

- short-lived authenticated session/access credential
- secure HttpOnly cookies where architecture permits
- Secure flag in production
- SameSite protection
- CSRF protection where cookie authentication requires it
- password hashing using a modern adaptive password hash
- optional MFA-ready architecture

Do not store sensitive authentication tokens in localStorage unless explicitly justified.

## RBAC

At minimum support a model capable of roles such as:

- Clinic Owner
- Doctor
- Nurse / Assistant
- Receptionist
- Billing / Accounts
- Clinic Admin

Authorization must be checked server-side.

UI hiding is not authorization.

Every sensitive operation requires a permission check.

---

# 9. Healthcare / Sensitive Data Handling

The application handles sensitive patient information.

Treat patient and clinical data as sensitive by default.

Examples include:

- demographics
- contact details
- medical history
- consultation notes
- diagnoses
- prescriptions
- laboratory information
- uploaded documents
- billing records

Rules:

- Encrypt data in transit.
- Use encrypted storage/database infrastructure in production.
- Never log clinical notes, passwords, tokens, or sensitive personal data unnecessarily.
- Never put sensitive data into analytics events unless explicitly justified and protected.
- Do not expose sensitive information in URLs unnecessarily.
- Use least-privilege access.
- Keep an audit trail for security-sensitive clinical and administrative actions.
- Define retention/deletion behaviour deliberately.
- Do not claim regulatory compliance merely because a control exists. Compliance must be reviewed separately against applicable requirements.

---

# 10. Auditability

Important actions should be auditable.

At minimum consider audit events for:

- login/logout/security events
- permission changes
- patient record creation
- patient data changes
- consultation changes
- prescription issue/changes
- invoice/payment changes
- document access/download
- exports
- deletion/archival
- administrative configuration changes

Audit records should contain, where appropriate:

- timestamp
- actor
- tenant
- action
- target entity/type
- target identifier
- outcome
- relevant metadata
- source/request information when safe

Do not store full sensitive payloads in audit logs unless explicitly required.

---

# 11. API Standards

Use a consistent HTTP API.

Rules:

- predictable resource-oriented routes
- explicit request and response schemas
- consistent error structure
- correct HTTP status codes
- pagination for potentially large collections
- filtering/sorting through explicit query parameters
- stable identifiers
- idempotency for operations where repeated requests can cause side effects
- API versioning when breaking changes are unavoidable

Never return database models directly without a deliberate API schema.

Never expose internal exception messages to users.

---

# 12. Error Handling

Errors must be useful to both users and developers.

## User-facing errors

Tell the user:

- what failed
- whether anything was saved
- what they can do next

Avoid:

- stack traces
- database errors
- internal service names
- raw exception messages

## Developer-facing errors

Use structured logging with:

- request/correlation ID
- error type
- route/action
- tenant context when safe
- actor context when safe
- stack trace in server logs

Never log:

- passwords
- access tokens
- session cookies
- secrets
- full payment credentials
- unnecessary clinical content

---

# 13. Validation

Validate at boundaries.

Frontend validation:

- improves UX
- prevents obvious mistakes
- gives immediate feedback

Backend validation:

- is authoritative
- must always exist for external input

Do not rely on client validation for security.

Use shared schemas/contracts where practical to reduce frontend/backend drift.

---

# 14. Database Rules

- Use migrations.
- Add indexes based on real query patterns.
- Index tenant + frequently filtered fields where appropriate.
- Use foreign keys and constraints where useful.
- Enforce uniqueness at database level when business rules require it.
- Avoid N+1 query patterns.
- Paginate large datasets.
- Never fetch entire tables just to filter in application code.
- Avoid premature denormalization.
- Use transactions around multi-entity state changes.

For every schema change consider:

1. migration
2. rollback safety
3. existing data
4. indexes
5. API compatibility
6. tenant isolation
7. tests

---

# 15. Forms & Data Entry

Forms are core to this product.

Prefer:

- clear field labels
- sensible defaults
- inline validation
- predictable tab order
- keyboard support
- autocomplete where useful
- date/time pickers where appropriate
- fewer fields visible initially
- grouped related fields
- clear required/optional indication

Do not:

- use placeholders as substitutes for labels
- clear user-entered data unexpectedly
- make a user re-enter information already known
- use complex multi-step forms unless the workflow genuinely requires them

For destructive or irreversible actions:

- explain the consequence
- require intentional confirmation when appropriate
- make the safe action obvious

---

# 16. Search

Patient and appointment search are critical workflows.

Search should:

- be fast
- tolerate common typing variations where appropriate
- support meaningful identifiers
- return useful empty states
- preserve authorization and tenant boundaries
- avoid exposing data outside the user's scope

Never use unbounded search queries against production data.

Implement debouncing where appropriate on interactive search.

---

# 17. Appointments & Scheduling

Appointments are a primary workflow.

Scheduling UX must prioritize:

- date
- time
- doctor/resource
- patient
- appointment type
- availability
- duration
- status
- notes when needed

Avoid requiring the user to navigate through multiple pages for simple booking.

Prevent double booking with server-side validation and transactional safeguards.

Client-side availability checks are helpful but are not sufficient protection against concurrent bookings.

Timezone handling must be explicit.

Store timestamps in a consistent backend representation and render them using the clinic/user timezone rules.

---

# 18. Clinical Data Rules

Clinical records should be append-friendly and auditable.

Do not silently overwrite historically meaningful clinical data.

Where business rules require immutability:

- create revisions
- record author
- record timestamp
- retain audit information
- distinguish draft from finalized records

Prescription and consultation flows should clearly distinguish:

- draft
- active/in-progress
- finalized/issued
- cancelled/void where applicable

Do not infer medical meaning in the UI that is not explicitly represented by application data.

---

# 19. Billing & Payments

Financial state must be explicit and transactional.

Examples:

- draft
- issued
- unpaid
- partially paid
- paid
- refunded
- cancelled
- failed

Never infer "paid" solely from frontend state.

Payment providers must be integrated behind a provider abstraction so the application does not depend on one vendor's API shape.

Use idempotency for payment-related side effects where supported.

Never store raw card details.

---

# 20. Notifications & Background Jobs

Use asynchronous jobs for tasks such as:

- email
- SMS
- WhatsApp messaging
- reminders
- report generation
- document processing
- exports
- scheduled follow-ups

Rules:

- jobs must be retry-safe
- side effects should be idempotent
- retry policies must avoid infinite loops
- failed jobs must be observable
- user-facing records should show meaningful delivery state where applicable

Do not introduce a background queue for trivial synchronous work.

---

# 21. Files & Documents

Documents may include prescriptions, reports, referrals, and other attachments.

Rules:

- store file metadata separately from binary storage
- use object storage in production
- generate controlled/signed access URLs where appropriate
- verify authorization before every file access
- validate file type and size
- generate safe filenames
- never trust client-provided MIME type alone
- do not execute uploaded files
- protect against path traversal
- consider malware scanning for untrusted uploads

---

# 22. Frontend Architecture

Organize UI primarily by feature/domain rather than a giant global component directory.

Prefer:

```text
features/
  patients/
  appointments/
  consultations/
  prescriptions/
  billing/
```

Shared components belong in the shared component layer only when they are genuinely reusable.

A component should not become a shared component simply because it exists in two files.

Keep:

- data fetching
- domain logic
- presentation
- form state

reasonably separated.

Avoid giant components.

---

# 23. State Management

Use the simplest state mechanism that works.

Priority:

1. local React state
2. URL state
3. TanStack Query server state
4. lightweight client store only when genuinely shared

Do not copy server state into a global client store without a strong reason.

Do not make global state the default architecture.

---

# 24. Performance

Performance is a product feature.

Prioritize:

- fast initial render
- fast patient search
- responsive appointment interactions
- minimal unnecessary network requests
- efficient database queries
- pagination
- caching where justified
- lazy loading of heavy modules
- optimized images/documents

Avoid premature micro-optimizations.

Measure before optimizing complex performance paths.

---

# 25. Accessibility

Target WCAG 2.2 AA-level practices where practical.

Required:

- keyboard navigation
- visible focus states
- semantic HTML
- accessible labels
- correct form error associations
- sufficient text contrast
- status not communicated by color alone
- meaningful button labels
- accessible dialogs/drawers
- sensible heading hierarchy
- minimum usable touch targets

Do not sacrifice accessibility for visual polish.

---

# 26. Responsive Design — Mobile Is a First-Class Platform

The application must provide a complete, production-quality experience across:

- mobile phones
- tablets
- laptops
- desktop workstations

**Mobile is not a secondary or reduced experience.**

The target market includes clinics in Tier 2 and Tier 3 cities where doctors, receptionists, assistants, and clinic owners may rely primarily on smartphones and may not have continuous access to laptops or desktop computers.

Therefore:

> **Every core product function must be accessible and usable on mobile.**

The web application must be designed with the future native mobile application in mind. The mobile web experience should establish the same information architecture, terminology, workflows, permissions, and interaction patterns that the future mobile app can reuse.

## Mobile requirements

Mobile must support the full core clinic workflow, including:

- authentication
- dashboard
- patient search
- patient registration
- patient profile
- appointment creation
- appointment rescheduling/cancellation
- appointment status changes
- check-in / queue
- consultation
- clinical notes
- diagnosis entry
- prescription creation
- prescription viewing/sharing
- lab reports
- referrals
- billing
- payment recording
- notifications
- reports where practical
- settings and account management

A feature must not be intentionally omitted from mobile simply because it is "more suitable for desktop."

When a workflow is genuinely harder on a small screen, redesign the interaction for mobile rather than removing the capability.

## Mobile-first product thinking

Design every new workflow by asking:

1. Can this be completed on a phone?
2. Can the primary action be reached comfortably with one hand?
3. Can important information be understood without excessive scrolling?
4. Can the user complete the workflow with touch?
5. Does it work on smaller screens and slower networks?
6. Is the interaction still fast enough for busy clinic staff?

Desktop should then enhance the workflow with additional space and density, rather than mobile being a compressed desktop implementation.

## Responsive strategy

Use progressive enhancement:

### Mobile

- single-column layouts by default
- bottom navigation or compact navigation where appropriate
- sticky primary actions where useful
- drawers/sheets instead of desktop-only modal patterns
- horizontally scrollable tabs only when necessary, with clear affordance
- stacked forms and sections
- compact but readable information blocks
- touch-friendly controls
- minimum comfortable touch targets
- no hover-dependent interactions

### Tablet

- use additional width for two-column layouts where useful
- support split views selectively
- retain touch-friendly interaction
- avoid assuming keyboard/mouse availability

### Desktop / Laptop

- increase information density where useful
- support multi-column layouts
- use persistent side navigation where appropriate
- support split panes for workflows such as patient + consultation
- use tables when they materially improve efficiency

## Tables on mobile

Do not simply squeeze desktop tables into tiny columns.

Instead, choose the best representation for the task:

- responsive table with prioritized columns
- stacked record rows
- card/list representation
- horizontal scrolling for genuinely tabular data
- expandable row details

The underlying information must remain available.

## Forms on mobile

Forms must be fully usable on phones.

- use appropriate input types
- use large enough controls for touch
- group related fields
- avoid unnecessary multi-column layouts
- keep important actions accessible
- avoid forcing users to zoom
- preserve entered data when validation fails
- use native/mobile-friendly date, time, search, and selection interactions where appropriate

## Navigation on mobile

The mobile navigation model must provide access to all major product areas.

Do not hide functionality solely because the primary desktop sidebar is unavailable.

The mobile information architecture should remain predictable and consistent with desktop.

## Performance on mobile

Assume some users may operate on:

- low-cost Android devices
- smaller screens
- slower processors
- unstable networks
- limited bandwidth

Therefore:

- minimize unnecessary JavaScript
- lazy-load heavy modules
- optimize images
- avoid shipping large dependencies unnecessarily
- provide useful loading states
- avoid blocking the entire UI for non-critical work
- support retry for recoverable network failures

Use Next.js capabilities such as route-level code splitting and optimized image delivery appropriately. Next.js itself documents responsive image patterns and route-based code splitting/prefetching for this type of application. citeturn714512search5turn714512search10

## Touch and accessibility

- touch targets should generally be at least 44px where practical
- do not rely on hover for essential information or actions
- support keyboard navigation on larger devices
- provide visible focus states
- maintain accessible labels and semantic HTML
- status must never rely solely on color

## Device continuity

The same user should be able to move between:

- phone
- tablet
- laptop
- desktop

without learning a different product.

Information architecture, terminology, status semantics, permissions, and core workflows must remain consistent across viewports.

## Future native mobile app

The web application is the foundation for a future native mobile application.

Therefore:

- keep domain logic independent from UI components
- maintain clear API/service boundaries
- use consistent resource identifiers
- keep business rules server-side
- avoid embedding critical business logic only in browser components
- design APIs and workflows so native clients can consume them later
- treat the mobile web implementation as a first-class client of the same product platform

> **Do not design desktop first and "make it responsive" later. Design the workflow for mobile and desktop together, with mobile treated as a first-class platform.**

---

# 27. Testing Strategy

Every meaningful feature should have tests at appropriate levels.

## Unit tests

Use for:

- business rules
- calculations
- validation
- permission logic
- status transitions
- utility functions

## API/integration tests

Use for:

- authorization
- tenant isolation
- database behaviour
- important workflows
- idempotency
- error cases

## Frontend tests

Use for:

- critical form behaviour
- important state transitions
- accessibility-sensitive interactions
- important component logic

## End-to-end tests

Use Playwright or the project's established equivalent for critical journeys:

- login
- patient creation
- patient search
- appointment booking
- appointment status transition
- consultation completion
- prescription issue
- invoice/payment flow
- role restrictions
- tenant isolation

Do not write brittle screenshot-only tests as the primary safety mechanism.

---

# 28. Verification Before Completion

Before declaring a task complete:

1. Run the smallest relevant tests.
2. Run type checking.
3. Run linting/formatting checks.
4. Run the affected frontend build if UI changed.
5. Run the affected API tests if backend changed.
6. Check migrations if schema changed.
7. Review the diff for unrelated changes.
8. Verify no secrets or sensitive data were added.
9. Verify UI changes against `DESIGN.md`.

For larger changes, run the full CI-equivalent suite before declaring completion.

---

# 29. Type Safety

Frontend:

- TypeScript strict mode.
- Avoid `any`.
- Prefer explicit types for API boundaries.
- Do not silence type errors without documenting why.

Backend:

- typed Pydantic schemas
- typed service interfaces where useful
- type checking in CI

Do not use type assertions to hide design problems.

---

# 30. Code Quality

Prefer:

- small cohesive functions
- clear names
- explicit dependencies
- deterministic behaviour
- simple control flow
- domain-oriented modules
- comments explaining "why", not obvious "what"

Avoid:

- giant functions
- giant components
- deeply nested conditionals
- speculative abstractions
- copy/paste business logic
- magic constants
- hidden side effects

---

# 31. Security Engineering

Always think about:

- authentication
- authorization
- tenant isolation
- injection
- XSS
- CSRF
- SSRF
- insecure file uploads
- broken access control
- rate limiting
- secret exposure
- dependency vulnerabilities
- sensitive data leakage
- session invalidation

Never:

- hard-code secrets
- commit `.env` files containing secrets
- disable TLS verification in production
- trust client-side authorization
- expose stack traces to users
- execute arbitrary user input as code
- construct SQL from untrusted strings
- bypass authorization "temporarily"

Any security shortcut must have an explicit reason and follow-up task.

---

# 32. Secrets & Configuration

Use environment variables or a proper secrets manager.

Commit:

- `.env.example`
- non-sensitive defaults
- configuration documentation

Never commit:

- API keys
- access tokens
- private keys
- production credentials
- database passwords

Configuration should fail clearly when required production values are missing.

---

# 33. Logging & Observability

Production systems need observable behaviour.

Use:

- structured logs
- request/correlation IDs
- health endpoints
- metrics for important system paths
- error reporting
- background job monitoring

Monitor at least:

- API errors
- request latency
- database failures
- job failures
- authentication failures
- notification failures
- payment failures
- storage failures

Do not log sensitive patient content merely for debugging convenience.

---

# 34. Health Checks

Provide appropriate health/readiness checks.

Separate:

- process is alive
- application can accept traffic
- required dependencies are available

Do not expose sensitive dependency details publicly.

---

# 35. Rate Limiting & Abuse Protection

Protect public and sensitive endpoints.

Rate-limit as appropriate:

- login
- password reset
- OTP
- public booking endpoints
- search endpoints
- export endpoints
- notification triggers
- expensive report generation

Do not apply a single arbitrary global limit to everything.

---

# 36. Dependency Management

Prefer stable, actively maintained dependencies.

Before adding a dependency ask:

1. Is it necessary?
2. Is there already an existing project dependency that solves it?
3. Is it maintained?
4. Does it introduce significant bundle/runtime/security cost?
5. Does it conflict with `DESIGN.md`?
6. Can the problem be solved with a small internal implementation?

Avoid dependency proliferation.

---

# 37. Version Control

Keep commits:

- focused
- understandable
- reversible
- free from unrelated formatting churn

Do not modify unrelated files to "clean things up" during a focused task.

Before committing:

- inspect `git diff`
- inspect `git status`
- confirm no secrets
- confirm tests appropriate to the change

Never rewrite shared history unless explicitly instructed.

---

# 38. Database Migration Safety

For migrations:

- create explicit migration files
- review generated SQL/operations
- consider existing production data
- avoid destructive changes without a deliberate migration plan
- use staged migrations for risky changes
- ensure indexes are appropriate
- test upgrade paths

For large data migrations, do not block the main request path unnecessarily.

---

# 39. API Contract Safety

When changing API contracts:

- identify all callers
- update schemas/types
- update frontend integration
- update tests
- preserve compatibility where practical
- use versioning for breaking changes when appropriate

Never change an API response casually just because a frontend implementation would be easier.

---

# 40. AI Features

AI may be used for features such as:

- visit summaries
- structured note assistance
- administrative automation
- document summarization
- drafting

AI output must be treated as assistance, not automatic medical truth.

Rules:

- show generated content clearly
- allow user review/editing before finalization where appropriate
- preserve human control over clinical decisions
- do not silently write clinical records without an explicit workflow
- audit important AI-assisted actions
- protect sensitive data sent to external AI providers
- isolate provider-specific code behind an abstraction
- do not hard-code one model/vendor into business logic

---

# 41. External Integrations

Wrap external vendors behind interfaces/adapters.

Examples:

- email
- SMS
- WhatsApp
- payment gateway
- object storage
- AI provider
- analytics
- identity provider

Do not scatter vendor SDK calls throughout the application.

A provider change should be localized to an adapter/service layer.

---

# 42. Jobs, Retries & Idempotency

Any operation that can be retried must be safe to retry.

For side-effecting operations use:

- idempotency keys
- provider event IDs
- unique constraints
- status tracking
- transactional outbox patterns when appropriate

Do not send duplicate notifications because a worker restarted.

---

# 43. Concurrency

Assume concurrent usage.

Examples:

- two receptionists booking the same slot
- doctor updating a consultation while assistant updates patient information
- two payments arriving close together
- two workers processing the same job

Use:

- transactions
- unique constraints
- optimistic locking/versioning where appropriate
- idempotent operations

Do not rely on "the UI shouldn't allow that" as concurrency protection.

---

# 44. Caching

Cache only when it improves a measured or obvious bottleneck.

Always define:

- cache key
- scope/tenant boundary
- TTL
- invalidation strategy
- stale-data tolerance

Never allow cached tenant data to leak across tenants.

Never cache sensitive data globally without careful isolation.

---

# 45. Data Export & Reporting

Exports can be expensive and sensitive.

Rules:

- authorize exports
- log important export actions
- paginate/process large exports asynchronously
- avoid loading huge datasets into memory
- protect generated export files
- expire temporary download links/files
- preserve tenant isolation

---

# 46. Production Readiness Checklist

Before calling the system production-ready, verify at minimum:

### Application

- [ ] authentication
- [ ] authorization
- [ ] tenant isolation
- [ ] validation
- [ ] error handling
- [ ] audit logging
- [ ] rate limiting
- [ ] secure file handling
- [ ] background job reliability

### Data

- [ ] PostgreSQL production setup
- [ ] migrations
- [ ] backups
- [ ] restore procedure tested
- [ ] indexes reviewed
- [ ] retention strategy defined

### Security

- [ ] secrets managed securely
- [ ] HTTPS
- [ ] secure cookies/session handling
- [ ] dependency scanning
- [ ] access-control tests
- [ ] sensitive logs reviewed

### Frontend

- [ ] `DESIGN.md` compliance
- [ ] accessibility checks
- [ ] responsive behaviour
- [ ] loading states
- [ ] empty states
- [ ] error states
- [ ] keyboard navigation

### Operations

- [ ] health/readiness checks
- [ ] structured logging
- [ ] metrics
- [ ] error reporting
- [ ] alerting
- [ ] CI/CD
- [ ] rollback strategy

---

# 47. Development Workflow

For each task:

## Step 1 — Understand

Inspect:

- relevant code
- existing patterns
- `AGENTS.md`
- `DESIGN.md` for UI work
- related tests
- API contracts
- database models/migrations

Do not immediately start editing.

## Step 2 — Plan

Identify:

- affected modules
- dependencies
- data changes
- UI changes
- tests required
- migration risks
- security implications

Keep the plan proportional to the task.

## Step 3 — Implement

Make the smallest coherent change.

Prefer modifying existing patterns over inventing new ones.

## Step 4 — Verify

Run focused tests first, then broader checks as appropriate.

## Step 5 — Review

Review:

- diff
- security
- tenant isolation
- UX
- accessibility
- performance
- backwards compatibility

## Step 6 — Report

Summarize:

- what changed
- why
- tests/checks run
- any known follow-up or limitation

---

# 48. Commands

The exact commands depend on the repository's package manager and scripts.

Once the project has settled on commands, keep the canonical commands in the root README and package configuration.

Typical commands are:

```bash
# Frontend
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build

# Next.js application
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build

# End-to-end
npx playwright test

# Supabase
# Use the repository's Supabase CLI/configuration when present.
# Keep schema changes and migrations aligned with the project's Supabase workflow.
```

Do not assume every command exists. Inspect `package.json`, `pyproject.toml`, Makefiles, task runners, and CI configuration before running or documenting commands.

---

# 49. Do Not Over-Engineer

The following are not goals by themselves:

- microservices
- Kubernetes
- event-driven architecture everywhere
- dozens of internal packages
- elaborate design patterns
- unnecessary abstraction layers
- infrastructure complexity
- excessive AI orchestration

Introduce complexity only when there is a concrete requirement.

> **A boring architecture that works reliably is better than an impressive architecture that is difficult to operate.**

---

# 50. Final Agent Rules

Before making a change, ask internally:

1. Does this follow `AGENTS.md`?
2. Does UI work follow `DESIGN.md`?
3. Does the change preserve tenant isolation?
4. Does it preserve authorization?
5. Does it protect sensitive data?
6. Does it introduce unnecessary complexity?
7. Is the behaviour testable?
8. Will this remain understandable six months from now?
9. Does it follow existing project patterns?
10. Is the user experience simpler after the change, not merely more feature-rich?

If the answer to any critical question is "no", fix the issue before considering the task complete.

---

# 51. Canonical References

Repository-level authorities:

- `AGENTS.md` — engineering and OpenCode instructions
- `DESIGN.md` — canonical UI/UX and design system
- `README.md` — developer setup and project overview
- `docs/` — detailed technical/product documentation

When new standards are introduced, update the appropriate canonical document rather than leaving the rule only in conversation history.
