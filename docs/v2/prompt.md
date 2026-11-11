# clinicOS v2.0 — Master Discovery, Product Re-engineering & Modernization Assessment

## 1. Project Context

clinicOS is a healthcare practice management SaaS platform designed primarily for independent doctors and small clinics in India.

The current v1.0 MVP is approximately 90% functionally complete. It was developed using coding agents, GSD (Get Shit Done), and various project-level agent and design instructions.

The MVP demonstrates that the core product workflows are viable. However, the implementation was optimized for speed of development rather than long-term production readiness, architectural consistency, security, maintainability, or exceptional user experience.

We are now initiating clinicOS v2.0.

This is an opportunity to critically reassess the entire application and elevate it to the standard of a professionally engineered, production-grade healthcare SaaS product.

### Primary objectives

1. Comprehensive UI/UX redesign and modernization.
2. Re-evaluation and modernization of the frontend technology stack.
3. Backend architecture refactoring and engineering standardization.
4. Security, privacy and data-protection assessment and remediation planning.
5. Improved maintainability, scalability, reliability and test coverage.
6. Establishment of a consistent engineering architecture and design system.
7. Preparation for production deployment and onboarding real clinics.

**This is not a cosmetic redesign or a simple refactoring exercise. We are open to fundamentally changing implementation choices wherever there is a demonstrable improvement.**

---

# 2. Your Role and Expectations

Act as a multidisciplinary senior engineering and product team consisting of:

- Principal Software Architect.
- Senior Product Designer and UX Architect.
- Senior Frontend Architect.
- Senior Backend Architect.
- Application Security Architect.
- Healthcare Data Privacy Specialist.
- QA and Test Automation Architect.
- DevOps and Production Reliability Engineer.

Approach the application as if you were engaged to modernize an existing commercial SaaS product for a serious production launch.

Challenge existing decisions. Do not blindly preserve existing architecture, libraries, components, coding conventions, design patterns or development practices.

At the same time, do not discard working business logic or product functionality without understanding its purpose.

Use evidence from the repository to support recommendations.

Clearly distinguish:
- Existing facts.
- Identified problems.
- Potential risks.
- Assumptions requiring validation.
- Recommended improvements.

Do not make changes merely to demonstrate technical sophistication.

Prefer the simplest maintainable solution that satisfies the product's actual requirements.

---

# 3. Working Rules and Repository Instructions

Before starting:

1. Inspect the complete repository structure.
2. Identify the technologies, frameworks, libraries and services currently in use.
3. Inspect existing agent instructions, GSD configuration, planning documents and design documents.
4. Identify which instructions are tool-specific and which contain actual product or engineering requirements.
5. Identify existing automated tests and available development workflows.
6. Determine how GSD is installed and operates in the current environment.

The previous implementation used Antigravity and OpenCode, but v2.0 may use Claude Code or another frontier-model environment.

Do not assume previous tool-specific configuration is required.

### Legacy instruction policy

The existing AGENTS.md and DESIGN.md represent the previous development approach.

They must not constrain the new architecture or design direction.

Treat them as historical references only.

The existing .planning directory may contain useful GSD project context, but its plans must be reviewed rather than automatically treated as approved v2.0 requirements.

Establish a clean, minimal project instruction structure appropriate for the new coding environment.

Where Claude Design or other relevant design skills are available, inspect and leverage them. Do not assume that a skill is installed merely because it is mentioned in a prompt.

### Git safety

The current v1.0 implementation is the functional baseline.

- Work only on the designated v2.0 branch.
- Never modify main or the v1.0 baseline.
- Do not overwrite or delete the existing application.
- Do not perform destructive database operations.
- Do not expose credentials, secrets or patient information.
- Do not change production infrastructure or deployment configuration without explicit approval.
- Preserve a rollback path for significant changes.

---

# 4. Workstream A — Product and Functional Discovery

First, understand the actual product.

Inspect the complete application and identify:

- All functional modules.
- All pages, routes and navigation structures.
- User roles and permissions.
- Authentication and onboarding flows.
- Database entities and relationships.
- APIs and integrations.
- Business rules and validation logic.
- Background jobs and scheduled processes.
- External communication integrations.
- Deployment and infrastructure dependencies.

Map the implemented functionality against the intended product capabilities.

Where implemented, assess:

- Appointment booking and scheduling.
- Patient registration and management.
- Patient medical records.
- Doctor and clinic management.
- Walk-in and queue management.
- E-prescriptions.
- Laboratory records and results.
- Referral management.
- Billing and payments.
- WhatsApp and SMS reminders.
- AI-assisted visit summaries.
- Clinic settings and administration.

Do not assume every feature is implemented or fully functional.

For every module, classify its current status:

- Working.
- Partially working.
- Incomplete.
- Broken.
- Not implemented.
- Requires further investigation.

Identify dependencies between modules and workflows that could be affected by future changes.

### Deliverable

PRODUCT_BASELINE.md

Include:
- Module inventory.
- User-role matrix.
- Critical user journeys.
- Existing business rules.
- Functional gaps.
- Dependencies.
- Known defects.
- Regression risks.

---

# 5. Workstream B — Comprehensive UI/UX Redesign

**This is one of the highest-priority objectives of v2.0.**

The existing frontend was built using a ready-to-use template to accelerate MVP development.

The template works, but it is not necessarily the right foundation for the long-term product.

Do not treat the existing template, component library, CSS framework, layouts, navigation, styling or visual language as constraints.

We expect an independent, extensive UI/UX reassessment and potentially a ground-up frontend redesign.

## B1. Existing UX Assessment

Inspect the application visually and technically.

Evaluate:

- Overall visual quality and consistency.
- Navigation and information architecture.
- User journeys and task completion.
- Dashboard usefulness.
- Form design and data entry experience.
- Tables, search, filters and pagination.
- Modal and dialog behaviour.
- Loading and empty states.
- Error messages and recovery.
- Responsive behaviour.
- Accessibility.
- Typography, spacing and visual hierarchy.
- Component reuse and consistency.

Identify unnecessary complexity, repetitive interactions, excessive clicks and poor information architecture.

Assess the application from the perspective of its actual users:

- Doctors.
- Receptionists.
- Clinic administrators.

Prioritize common daily tasks over visually impressive but rarely used functionality.

## B2. Frontend Technology and Component Library Re-evaluation

Do not assume the existing frontend technology or component library should be retained.

Independently assess whether the current foundation is appropriate for clinicOS v2.0.

Consider alternatives where compatible with the actual stack, including:

- React and its ecosystem.
- Tailwind CSS.
- shadcn/ui.
- Radix UI.
- Material UI.
- Ant Design.
- Other modern, actively maintained component libraries.
- Alternative frontend frameworks if there is a compelling architectural justification.

Evaluate options against:

1. Design flexibility.
2. Accessibility.
3. Component quality.
4. Responsive capabilities.
5. Developer experience.
6. Maintainability.
7. Performance and bundle size.
8. Ecosystem maturity.
9. Long-term sustainability.
10. Migration effort and compatibility.

Do not choose a technology simply because it is popular.

For example, evaluate whether Tailwind CSS combined with shadcn/ui and Radix primitives would provide a better foundation than the current template.

If replacing the existing frontend foundation is justified, recommend it explicitly.

Explain:
- Why the existing solution is insufficient.
- Which alternative is recommended.
- Why it is better.
- Migration complexity.
- Risks.
- Dependencies.
- Estimated implementation effort.

Do not implement a new library or framework before the technology recommendation is approved.

## B3. Design Capabilities and Claude Design Skills

Where available, use Claude's relevant design skills and frontend design capabilities.

Inspect available skills and their instructions before using them.

Approach the redesign as a professional product-design exercise, not generic AI dashboard generation.

The resulting application should have the visual quality and interaction consistency expected of a polished commercial SaaS product.

Avoid:
- Generic dashboard templates.
- Excessive cards and nested containers.
- Unnecessary gradients.
- Arbitrary colours.
- Inconsistent typography.
- Inconsistent spacing.
- Overloaded navigation.
- Excessive visual decoration.
- Poorly designed forms and tables.
- Desktop-first layouts that break on mobile.
- Unnecessary animations.

## B4. clinicOS Design Philosophy

clinicOS should feel like a modern, professional, trustworthy and intuitive healthcare operations platform.

The primary audience includes independent doctors and small clinics in India, including tier-2 and tier-3 cities.

Design priorities:

- Simplicity over complexity.
- Ease of learning.
- Fast task completion.
- Minimal cognitive load.
- Readability.
- Accessibility.
- Consistency.
- Mobile-first usability.
- Efficient patient and appointment management.
- Clear feedback and error recovery.

Maintain a professional light-theme-first visual language.

Do not introduce a dark theme unless there is a strong product requirement.

## B5. New Design System

Create a completely new v2.0 design system.

Define:

- Colour palette.
- Semantic colour tokens.
- Typography and font hierarchy.
- Spacing scale.
- Layout and grid system.
- Responsive breakpoints.
- Border and radius conventions.
- Elevation and shadows.
- Button variants.
- Input and form components.
- Selects and dropdowns.
- Dialogs and drawers.
- Navigation.
- Tables and data lists.
- Search and filtering.
- Notifications and alerts.
- Loading and skeleton states.
- Empty states.
- Error states.
- Accessibility conventions.

Include reusable healthcare-specific patterns where appropriate.

Ensure the design system is implemented consistently rather than remaining a theoretical document.

## B6. Critical Workflow Redesign

Prioritize the most frequently used clinic workflows.

At minimum, evaluate:

- Patient registration.
- Appointment booking.
- Appointment rescheduling and cancellation.
- Walk-in registration.
- Queue management.
- Patient search and retrieval.
- Patient history.
- Doctor consultation workflows.
- Prescription creation.
- Billing and payment collection.

For each workflow:

1. Understand the existing implementation.
2. Identify usability problems.
3. Propose an improved interaction model.
4. Define the redesigned interface.
5. Validate it against actual business requirements.
6. Identify the APIs and backend dependencies.

### Deliverables

- UX_AUDIT.md
- DESIGN_SYSTEM.md
- FRONTEND_TECHNOLOGY_ASSESSMENT.md
- INFORMATION_ARCHITECTURE.md
- FRONTEND_MIGRATION_PLAN.md

Provide representative wireframes, prototypes or implemented design explorations for critical workflows before committing to the complete redesign.

---

# 6. Workstream C — Backend Architecture Assessment and Modernization

The backend must be assessed independently of the frontend.

Do not assume that existing architecture is appropriate simply because the application currently works.

Evaluate:

- Application architecture.
- Module boundaries.
- Service responsibilities.
- API design.
- Database architecture.
- Data relationships.
- Database constraints.
- Transaction handling.
- Validation.
- Error handling.
- Authentication.
- Authorization.
- Tenant isolation.
- Logging.
- Background jobs.
- Caching, where justified.
- External integrations.
- Dependency management.
- Performance.
- Scalability.

## C1. Architecture Principles

Recommend an architecture that is:

- Maintainable.
- Modular.
- Testable.
- Secure.
- Observable.
- Reliable.
- Appropriately scalable.

Avoid unnecessary microservices, excessive abstractions or infrastructure complexity.

Do not introduce distributed architecture simply because it is considered modern.

Prefer well-defined modular boundaries and straightforward deployment unless actual requirements justify more complexity.

## C2. Database and Data Integrity

Review:

- Database schema.
- Relationships and foreign keys.
- Indexes.
- Constraints.
- Data validation.
- Migration practices.
- Transaction boundaries.
- Data consistency.
- Backup and restoration.
- Data retention and deletion.

Pay particular attention to patient records, appointments, prescriptions, payments and clinic-level data isolation.

Identify any schema changes that may affect existing data.

Do not execute destructive migrations during assessment.

## C3. API and Integration Standards

Assess API consistency, validation, error responses, versioning and documentation.

Review third-party integrations, including messaging and payment services where implemented.

Ensure sensitive information is not unnecessarily exposed through API responses, logs or external integrations.

### Deliverables

- ARCHITECTURE_ASSESSMENT.md
- TARGET_ARCHITECTURE.md
- API_ASSESSMENT.md
- DATABASE_ASSESSMENT.md
- ARCHITECTURE_DECISIONS.md
- BACKEND_MIGRATION_PLAN.md

---

# 7. Workstream D — Security, Privacy and Compliance Assessment

Security is a release-critical workstream.

clinicOS processes sensitive healthcare information. Its security posture must be assessed accordingly.

Perform a comprehensive application-security assessment.

## D1. Authentication and Authorization

Review:

- Authentication mechanisms.
- Session management.
- Password handling.
- Multi-factor authentication, where appropriate.
- Role-based access control.
- Permission enforcement.
- Object-level authorization.
- Clinic-level tenant isolation.
- Privilege escalation risks.
- Account recovery.
- Session expiry and revocation.

Explicitly verify that one clinic cannot access another clinic's patients, appointments, prescriptions, invoices or other private information.

Do not rely on frontend permission checks for security.

## D2. Application and API Security

Assess against relevant OWASP guidance, including:

- OWASP Top 10.
- OWASP API Security Top 10.
- Injection vulnerabilities.
- Cross-site scripting.
- Cross-site request forgery, where applicable.
- Broken access control.
- Insecure direct object references.
- Server-side request forgery.
- Insecure file uploads.
- Security misconfiguration.
- Sensitive data exposure.
- Dependency vulnerabilities.
- Secrets leakage.
- Rate limiting and abuse prevention.

## D3. Healthcare Data Protection

Assess:

- Patient information handling.
- Data minimization.
- Encryption in transit and at rest.
- Access logging.
- Audit trails.
- Data retention.
- Data deletion.
- Backups.
- Third-party processors.
- Messaging integrations.
- AI integrations.
- Patient consent and communication preferences.
- Data export and portability.

Ensure real patient information is not used in development prompts, test fixtures or external AI tooling without appropriate safeguards and authorization.

## D4. Regulatory and Compliance Considerations

Assess applicability and implications of:

- India's Digital Personal Data Protection Act and applicable rules.
- Relevant Indian healthcare-data requirements.
- Applicable CERT-In directions.
- HIPAA, if the product's customers, operations or contractual obligations make it applicable.
- GDPR, if the product processes personal data within its territorial scope.

Do not automatically assume that HIPAA applies because clinicOS is healthcare software.

Distinguish legal obligations, technical controls, contractual requirements and voluntary security practices.

Do not claim certification or compliance without appropriate evidence and professional validation.

## D5. Security Testing

Recommend and, once approved, conduct appropriate:

- Static application security testing.
- Software composition analysis.
- Secret scanning.
- Dynamic application security testing.
- API security testing.
- Dependency vulnerability assessment.
- Manual code review.
- Threat modelling.
- Authorization and tenant-isolation testing.

### Deliverables

- SECURITY_ASSESSMENT.md
- THREAT_MODEL.md
- DATA_HANDLING.md
- SECURITY_REMEDIATION_PLAN.md
- SECURITY_VERIFICATION_PLAN.md

Every finding must include:
- Severity.
- Evidence.
- Affected component.
- Potential impact.
- Recommended remediation.
- Verification method.

---

# 8. Workstream E — Quality Engineering and Testing

Assess the existing testing strategy and identify gaps.

Establish a testing approach covering:

- Unit tests.
- Integration tests.
- API tests.
- Database tests.
- End-to-end tests.
- UI component tests.
- Regression tests.
- Security tests.
- Responsive UI tests.
- Performance tests.

Prioritize critical business journeys.

Create automated tests for:

- Authentication.
- Role permissions.
- Clinic isolation.
- Patient registration.
- Appointment management.
- Queue operations.
- Patient record access.
- Prescription workflows.
- Billing.
- Critical integrations.

Ensure tests verify actual outcomes rather than merely confirming that pages load.

Use synthetic test data only.

### Deliverable

TEST_STRATEGY.md

Include coverage priorities, test tooling recommendations, execution strategy and release acceptance criteria.

---

# 9. Workstream F — Infrastructure, Deployment and Reliability

Assess the current deployment and operational setup.

Review:

- Environment separation.
- Configuration management.
- Secrets management.
- CI/CD.
- Build processes.
- Deployment procedures.
- Database migrations.
- Monitoring.
- Logging.
- Error tracking.
- Backup and recovery.
- Incident response.
- Dependency updates.
- Availability and performance.

Do not recommend additional infrastructure unless justified by actual requirements.

Consider the expected scale of independent clinics and the operational capacity of a small engineering team.

### Deliverable

INFRASTRUCTURE_ASSESSMENT.md

---

# 10. Target Architecture and Technology Recommendations

After completing the assessments, consolidate the findings into a proposed v2.0 architecture.

The recommendation must cover:

1. Frontend framework.
2. Component library and styling system.
3. Design-system implementation.
4. Backend architecture.
5. Database and data-access approach.
6. Authentication and authorization.
7. Tenant isolation.
8. API contracts.
9. Integrations.
10. Testing infrastructure.
11. Security tooling.
12. CI/CD and deployment.
13. Monitoring and observability.

For each major technology decision, explain:

- Current choice.
- Recommended choice.
- Reason for change or retention.
- Advantages.
- Disadvantages.
- Migration complexity.
- Operational implications.

Do not change technology choices merely for novelty.

---

# 11. GSD and Development Workflow

GSD may be retained as the execution framework for v2.0, provided it supports the proposed workflow effectively.

First inspect the installed GSD version and how it integrates with the current coding environment.

Do not assume that previous Antigravity or OpenCode configurations are compatible with Claude Code.

Use GSD to structure the approved work into:

- Milestones.
- Phases.
- Plans.
- Tasks.
- Verification criteria.

Avoid creating one enormous rebuild task.

Break work into independently reviewable units.

Each implementation task should specify:

- Objective.
- Scope.
- Dependencies.
- Expected changes.
- Acceptance criteria.
- Tests.
- Verification evidence.

Maintain one approved source of truth for architecture, product requirements and design decisions.

Do not allow implementation agents to silently change approved architecture or product requirements.

---

# 12. Implementation Strategy

The work must be executed incrementally.

Recommended sequence:

### Phase 0 — Baseline and preparation
- Confirm v1.0 baseline.
- Review Git branch and rollback strategy.
- Identify current tests and known issues.
- Inspect and clean up legacy agent configuration.
- Establish minimal v2.0 instructions.

### Phase 1 — Discovery and assessment
- Complete product discovery.
- Complete architecture assessment.
- Complete security assessment.
- Complete UX assessment.
- Evaluate frontend technology alternatives.

### Phase 2 — Architecture and design approval
- Approve target architecture.
- Approve frontend technology choices.
- Approve new design direction.
- Approve data and API migration approach.
- Establish acceptance criteria.

### Phase 3 — Engineering foundations
- Establish new design system.
- Establish frontend architecture.
- Establish backend engineering standards.
- Improve automated testing.
- Address foundational security weaknesses.

### Phase 4 — Incremental implementation
- Redesign and implement critical workflows.
- Refactor backend modules incrementally.
- Maintain API and data compatibility where possible.
- Introduce and validate database migrations.
- Add regression and integration tests.

### Phase 5 — Security remediation
- Remediate identified findings.
- Perform independent verification.
- Validate tenant isolation and sensitive-data access.
- Complete security testing.

### Phase 6 — Production readiness
- Complete regression testing.
- Validate mobile and desktop experiences.
- Test backups and recovery.
- Validate production configuration.
- Complete release documentation.
- Prepare controlled pilot deployment.

---

# 13. Independent Review and Quality Gates

Do not allow the same implementation agent to be the sole approver of its own work.

Where possible, use a separate reviewer or another frontier model to independently assess:

- Architecture decisions.
- Design quality.
- Backend changes.
- Security fixes.
- Test coverage.
- Release readiness.

Use automated evidence wherever possible.

Every major phase must have an explicit approval gate.

No large-scale implementation should begin before the relevant architecture and design decisions are approved.

---

# 14. Required Master Deliverable — V2.0 MASTER ROADMAP

After completing all discovery and assessment work, consolidate the results into:

V2_MASTER_ROADMAP.md

This must be the central execution document for clinicOS v2.0.

It must include:

1. Executive summary.
2. Current product assessment.
3. Existing architecture assessment.
4. UI/UX assessment.
5. Recommended frontend technology and design system.
6. Target backend architecture.
7. Security and privacy findings.
8. Testing strategy.
9. Infrastructure recommendations.
10. Prioritized technical debt.
11. Recommended migration strategy.
12. GSD milestone breakdown.
13. Dependencies and risks.
14. Estimated complexity and effort.
15. Acceptance criteria.
16. Approval gates.
17. Production-readiness criteria.

Prioritize recommendations into:

- P0: Critical blockers and security risks.
- P1: Essential v2.0 improvements.
- P2: Important improvements.
- P3: Optional enhancements and future opportunities.

Provide a realistic implementation sequence. Do not invent precise effort estimates where repository evidence is insufficient; use relative sizing and explain assumptions.

---

# 15. STRICT EXECUTION BOUNDARY

**THIS INITIAL ENGAGEMENT IS DISCOVERY, ASSESSMENT AND PLANNING ONLY.**

You are authorized to:

- Inspect the repository.
- Read and analyse source code.
- Inspect configurations.
- Run non-destructive tests.
- Run safe, local analysis tools.
- Inspect available design skills.
- Produce assessment documents.
- Produce recommendations.
- Create the proposed v2.0 roadmap.

You are NOT authorized to:

- Rewrite the application.
- Replace the frontend framework.
- Install or remove dependencies.
- Modify database schemas.
- Perform destructive migrations.
- Change production configurations.
- Change authentication or authorization implementations.
- Deploy changes.
- Modify existing application behaviour.
- Start implementing the proposed architecture.

Do not confuse discovery with implementation.

If a finding cannot be verified safely, document it as an outstanding investigation.

## Final Instruction

Think independently. Challenge assumptions. Evaluate alternatives. Prioritize product quality, engineering discipline, security and maintainability over speed of code generation.

The existing MVP proves the product concept and provides a functional baseline. It does not dictate what clinicOS v2.0 must look like internally or visually.

We want to build a genuinely better product, not simply make the existing implementation look cleaner.

Complete the discovery and assessment, prepare the V2.0 MASTER ROADMAP, and stop for product-owner review and approval before implementation.