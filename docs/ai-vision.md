# CliniQ AI --- AI Product Vision

**Document type:** Product Vision & Concept Definition\
**Version:** 1.0\
**Status:** Vision draft for discussion\
**Product:** CliniQ AI\
**Company:** The CliniQ AI, owned by Samar AI Solutions Pvt. Ltd.\
**Last updated:** 28 October 2026

------------------------------------------------------------------------

## 1. Executive Summary

CliniQ AI aims to make artificial intelligence a practical, integrated
part of everyday clinic operations and clinical workflows. The goal is
not to add a generic chatbot to the application, but to help clinic
teams complete work more naturally and help doctors reduce
administrative and information-retrieval burden during consultations.

The initial vision consists of two complementary AI capabilities:

1.  **Operations Copilot** --- an application-aware assistant that
    answers questions about CliniQ AI and can perform supported actions
    on behalf of an authorized user, subject to permissions, validation
    and appropriate human confirmation.
2.  **Clinical Copilot** --- a doctor-focused assistant that helps
    prepare clinical documentation, retrieve clinical reference
    information, identify relevant coding options and suggest treatment
    or medication considerations for the doctor to assess. It does not
    independently make clinical decisions or issue prescriptions.

The two capabilities may share a common AI entry point and underlying
platform, but they must remain distinct in purpose, context, access and
safety rules. Operations assistance is concerned with using and
operating the clinic-management application. Clinical assistance
supports the doctor's workflow and must apply stricter clinical
safeguards.

**Voice-based ambient listening is explicitly a later phase.** The first
releases should work with user-provided text, explicit prompts and data
already available in the application. Microphone selection, speaker
identification, consultation recording and automatic transcription are
not prerequisites for the initial AI capabilities.

This document records the product vision and intended boundaries. It is
not yet a technical architecture, implementation specification or
clinical validation plan.

## 2. Product Context and Vision

CliniQ AI is designed to support the day-to-day needs of clinics,
including appointment management, patient records, consultation
workflows, documentation, communication and administrative work.

AI should make these capabilities easier to use without forcing doctors
or staff to learn complicated prompts or change every established
workflow. Users should be able to express an intention in ordinary
language, receive a useful response, and---where supported---ask the
system to carry out the work.

### Vision statement

> **Make CliniQ AI an intelligent clinic platform that helps clinic
> teams get administrative work done and helps doctors document and
> reason more efficiently, while keeping people in control of
> consequential actions and clinical decisions.**

### Product principles

-   **Useful before impressive:** Prioritize reliable, frequent clinic
    tasks over novelty.
-   **Action-oriented:** Where authorized and supported, the AI should
    do the work rather than only explain how to do it.
-   **Human control:** Users approve consequential operational actions;
    doctors retain responsibility for clinical decisions.
-   **Context-aware:** Use the current screen, selected patient,
    encounter and user role when relevant and permitted.
-   **Permission-aware:** The AI must never grant itself access that the
    logged-in user does not have.
-   **Transparent:** Clearly distinguish facts retrieved from the
    system, information supplied by the user, generated suggestions and
    uncertain details.
-   **Safe by design:** Validate inputs and actions, preserve
    auditability, and fail safely when information is missing or
    ambiguous.
-   **Incremental delivery:** Start with explicit text interaction and
    existing application data; add more complex modalities only after
    the foundations are proven.

## 3. The Two AI Capabilities

### 3.1 Operations Copilot

#### Purpose

The Operations Copilot is the general-purpose assistant for using and
operating CliniQ AI. It should understand the product's supported
features, guide users through workflows and perform permitted
application actions through defined tools or APIs.

It serves the people who operate the clinic, including doctors,
receptionists and clinic administrators, within the permissions assigned
to each role.

#### Primary capabilities

**A. Product and workflow assistance**

The assistant should answer questions about CliniQ AI features and
explain how to complete common tasks.

Examples: - "How do I book an appointment?" - "How can I change
notification preferences?" - "How do I add a patient?" - "Where can I
see today's appointments?" - "How do appointment reminders work?"

Where useful, the assistant should provide concise instructions or guide
the user to the relevant screen. It should not claim a feature exists
unless it can verify that the feature is available in the current
product configuration.

**B. Action execution**

The assistant should be able to perform supported actions on behalf of
the user, rather than merely providing instructions.

Examples: - "Book an appointment for Mr. John on the 11th at 11:00
AM." - "Move Priya's appointment to tomorrow afternoon." - "Show me
today's unconfirmed appointments." - "Change my notification preferences
to WhatsApp only."

Actions must be executed through controlled application functions---not
by allowing the model unrestricted access to the database or application
environment.

**C. Information retrieval**

Where the user has access, the assistant may retrieve and summarize
information from CliniQ AI, such as appointment lists, patient records
or workflow status. It should only expose information that the user is
authorized to view.

#### Example: appointment booking

1.  The user requests an appointment for a named patient and time.
2.  The assistant resolves the patient identity. If multiple patients
    match, it asks the user to disambiguate.
3.  It checks the requested date, provider, clinic rules and slot
    availability.
4.  It asks for missing required details instead of guessing.
5.  It presents a booking summary, including patient, provider, date,
    time and relevant details.
6.  The user confirms the booking.
7.  The system revalidates availability and permissions before
    committing the booking.
8.  The assistant reports the actual result. It must not claim success
    unless the application confirms that the appointment was created.

If the slot is no longer available, the assistant should explain that
and offer available alternatives where supported.

#### Operational safety and autonomy

The Operations Copilot should use a risk-aware confirmation model:

-   **Read-only, low-risk tasks:** May proceed directly when the user is
    authorized.
-   **Routine changes:** May require a preview or confirmation depending
    on impact and reversibility.
-   **Consequential actions** such as booking, rescheduling or
    cancelling appointments: Show a clear summary and obtain
    confirmation before committing, at least in the initial release.
-   **Ambiguous or unauthorized requests:** Ask a clarifying question or
    explain the permission limitation.
-   **Failed actions:** Report failure accurately and avoid claiming
    that a change was completed.

The assistant should protect against duplicate submissions, stale
availability, conflicting updates and accidental actions caused by
ambiguous language.

#### Initial scope

The initial Operations Copilot should focus on: - Product help and
workflow questions. - Appointment lookup and booking workflows. -
Appointment rescheduling and cancellation, with confirmation. - User
preference changes, within authorized limits. - Selected read-only
summaries from application data. - Clear handling of missing
information, ambiguity, permissions and tool failures.

The exact action list should be agreed against the current CliniQ AI
feature set before implementation.

### 3.2 Clinical Copilot

#### Purpose

The Clinical Copilot is an assistant embedded in the doctor's
consultation workflow. It helps the doctor prepare documentation and
access relevant clinical reference information without replacing
professional judgment.

The initial version should operate from explicit doctor input and
information already available in the selected patient or encounter. It
should not depend on listening to the consultation.

#### Primary capabilities

**A. Clinical documentation**

The assistant can turn notes or information supplied by the doctor into
structured, editable drafts, such as: - Visit or consultation
summaries. - History of present illness. - Relevant medical history,
when provided or retrieved with authorization. - Examination findings,
when explicitly documented. - Assessment and differential
considerations, where requested. - Draft treatment plans. - Follow-up
instructions. - Patient-friendly explanations based on the doctor's
approved plan.

The AI must not invent missing symptoms, examination findings,
diagnoses, allergies, vital signs or other patient facts to make a note
appear complete. Missing information should be left blank, marked as not
provided, or raised for the doctor to clarify.

**B. Clinical reference and coding assistance**

The doctor may ask focused questions during a consultation.

Examples: - "What is the ICD-10 code for dental caries?" - "Explain the
difference between these two possible codes." - "What information is
needed to choose the correct code?" - "Summarize the relevant clinical
considerations for this condition."

Coding suggestions should include a code description and relevant
context. The assistant should identify ambiguity and ask for additional
details when the code depends on the specific diagnosis, severity, site,
encounter or coding system. The doctor must verify the code before it is
finalized in the clinical record.

**C. Treatment-plan suggestions**

The assistant may prepare a draft or outline of commonly considered
management options based on the information provided, with relevant
limitations and prompts for missing information.

It should: - Separate documented patient facts from generated
suggestions. - Explain when the available information is insufficient. -
Avoid presenting a suggestion as a confirmed diagnosis or definitive
treatment. - Encourage the doctor to consider relevant patient-specific
factors, contraindications and applicable clinical guidance. - Present
options for the doctor to evaluate rather than silently choosing and
executing a plan.

**D. Medication decision support**

Medication-related output is especially sensitive. The assistant may
provide suggestions for the doctor to consider, but must not
autonomously prescribe, issue a prescription or represent a medication
as appropriate without adequate patient-specific context.

Where relevant and supported by reliable information, the assistant
should surface considerations such as allergies, contraindications,
interactions, age, pregnancy status, comorbidities, current medication,
dose, route and duration. If necessary information is unavailable, it
should say so rather than assume it.

Medication suggestions must be checked by the doctor against reliable,
current clinical references and applicable local requirements.

#### Doctor approval and clinical record integrity

All AI-generated clinical documentation should be treated as a **draft**
until reviewed and approved by the doctor.

The intended flow is: 1. The doctor opens the correct patient and
encounter. 2. The doctor enters notes or asks the assistant a question.
3. The assistant uses only authorized, relevant context. 4. It generates
an editable draft or reference response. 5. The doctor reviews, corrects
and approves the content. 6. Only the approved content is saved as
finalized clinical documentation, according to the application's
existing workflow. 7. The system records appropriate provenance and
audit information.

A generated suggestion should never be silently inserted as a confirmed
clinical fact. The UI should make it clear which content is AI-generated
and which content has been reviewed or approved.

#### Initial scope

The first Clinical Copilot release should focus on: - Drafting
consultation summaries from doctor-provided text. - Structuring and
improving doctor-entered clinical notes without changing their
meaning. - Answering focused clinical reference questions using suitable
sources. - Suggesting ICD-10 codes with descriptions and uncertainty
handling. - Drafting treatment-plan options for doctor review. -
Providing carefully bounded medication decision support, subject to
clinical safety review. - Maintaining explicit doctor review and
approval before finalization.

Clinical capabilities should be introduced incrementally. Documentation
and coding assistance are suitable starting points for evaluation;
medication-related functionality requires particularly careful
validation.

## 4. Unified Experience, Distinct Responsibilities

The two capabilities may share a familiar AI interface and common
conversation experience, but the product must preserve the distinction
between operational and clinical work.

### Suggested experience

**Global AI entry point** - Available across relevant parts of the
application. - Handles product questions and operational requests. -
Uses the current application context where appropriate. - Offers clear
action previews and confirmations.

**Clinical AI entry point in the consultation screen** - Visible when
the doctor is working on an encounter. - Can use the selected patient
and encounter context when authorized. - Supports documentation drafting
and clinical reference questions. - Keeps clinical suggestions separate
from finalized patient records. - Makes review and approval part of the
workflow.

A shared interface does not require one unrestricted agent. The system
can route a request to the appropriate capability based on user intent,
current context, permissions and risk. If intent is unclear---especially
when a request could modify a patient record---the assistant should ask
a clarifying question.

### Example interactions

**Operations** \> User: "Book an appointment for Mr. John on the 11th at
11 AM."\
\> Assistant: Checks the patient and availability, resolves missing
details, then shows a booking preview for confirmation.

**Product help** \> User: "How do I change notification preferences?"\
\> Assistant: Explains the steps or offers to make the change if the
user is authorized and the setting is supported.

**Clinical documentation** \> Doctor: "Create a concise visit summary
from these notes."\
\> Assistant: Produces an editable draft based only on supplied or
authorized information, identifying gaps rather than inventing facts.

**Clinical reference** \> Doctor: "What is the ICD-10 code for this
condition?"\
\> Assistant: Offers a candidate code and description, explains any
relevant ambiguity and asks for additional details if needed.

**Treatment support** \> Doctor: "Suggest treatment options based on
this assessment."\
\> Assistant: Presents a clearly labelled draft of options and relevant
considerations for the doctor to evaluate. It does not issue orders or
prescriptions.

## 5. Shared AI Foundation

The Operations Copilot and Clinical Copilot should use a shared platform
where practical, while enforcing separate capability boundaries.

Conceptually, the shared foundation may include:

-   **Conversation management:** Maintains conversation state and
    relevant context.
-   **Intent and capability routing:** Determines whether a request
    belongs to operations, clinical assistance or needs clarification.
-   **Identity and authorization:** Uses the current user's identity,
    role, clinic and permissions.
-   **Context retrieval:** Retrieves only the product, appointment,
    patient or encounter information necessary and authorized for the
    request.
-   **Controlled tool execution:** Exposes narrowly defined application
    actions with validated inputs and outputs.
-   **Knowledge retrieval:** Provides product documentation and,
    separately, suitable clinical references.
-   **Validation and confirmation:** Checks inputs, constraints,
    conflicts and required approvals.
-   **Audit and provenance:** Records relevant actions and the origin or
    approval status of generated content.
-   **Model integration:** Allows the product to evaluate or change
    underlying models without redesigning the user experience.
-   **Failure handling:** Handles timeouts, unavailable services,
    conflicting updates, low-confidence responses and partial failures
    safely.

This is a conceptual foundation, not a commitment to a particular
framework, model vendor or infrastructure design.

### Important separation

Product knowledge and clinical knowledge should not be treated as one
undifferentiated knowledge base. The Operations Copilot should rely on
verified CliniQ AI product documentation and live application data where
appropriate. The Clinical Copilot should rely on authorized patient
context and suitable clinical sources, with explicit attention to
freshness, relevance and uncertainty.

Likewise, tools available to the Operations Copilot should not
automatically be available to the Clinical Copilot. Each capability
should receive only the tools and permissions required for its job.

## 6. Safety, Privacy and Governance

AI in a clinic application must be designed around the sensitivity of
patient data and the consequences of mistakes.

### Access control

-   Enforce permissions in the application or service layer, not only in
    prompts.
-   Never allow the model to bypass existing user, clinic or patient
    access rules.
-   Minimize the patient information retrieved for each task.
-   Avoid exposing one clinic's information to another clinic or
    unauthorized user.
-   Recheck permissions when executing an action, not just when the
    conversation starts.

### Human oversight

-   Require confirmation for consequential operational actions in the
    initial release.
-   Require doctor review of clinical drafts, codes and treatment
    suggestions.
-   Do not allow autonomous prescribing or autonomous finalization of
    clinical decisions.
-   Make the difference between a draft, a suggestion and an approved
    record unmistakable.

### Accuracy and uncertainty

-   Ask clarifying questions when patient identity, dates, intent or
    clinical context is ambiguous.
-   Do not invent unavailable information.
-   Communicate uncertainty in a useful, specific way.
-   Prefer source-backed clinical information for reference and coding.
-   Make it possible to correct errors and report problematic outputs.

### Auditability

Subject to applicable retention and privacy requirements, maintain
appropriate records of: - Operational actions requested and executed. -
User confirmation and action results. - Relevant AI-generated clinical
drafts and approval status. - Sources used for reference responses,
where supported. - Errors, corrections and relevant safety events.

Audit records should be access-controlled and should avoid collecting
unnecessary sensitive information.

### Privacy and regulatory review

Before deploying clinical AI, CliniQ AI should conduct a privacy and
security review covering the applicable Indian data-protection
framework, healthcare obligations, contractual requirements and clinic
workflows. Any later introduction of consultation recording or voice
processing will require a separate assessment of consent, recording
notices, access, retention, deletion and data processing.

This vision document does not itself establish legal or clinical
compliance. Those requirements must be validated with qualified experts
before production use.

## 7. Phased Roadmap

### Phase 1 --- Operations Copilot

**Goal:** Prove that users can reliably get work done through natural
language.

Potential milestones: 1. Answer questions grounded in verified product
documentation. 2. Retrieve authorized, read-only application
information. 3. Support a narrow appointment-booking workflow with
availability validation and explicit confirmation. 4. Add rescheduling
and cancellation with appropriate safeguards. 5. Support selected
settings and preference changes. 6. Evaluate task success, incorrect
actions, latency, user corrections and usability.

**Exit criteria:** The assistant consistently answers product questions
accurately, respects permissions and completes supported actions without
duplicate or unintended changes. Action results must be verifiable.

### Phase 2 --- Clinical Copilot

**Goal:** Reduce documentation and information-retrieval effort while
maintaining doctor control.

Potential milestones: 1. Draft visit summaries from text entered by the
doctor. 2. Structure notes and preserve the original meaning. 3. Provide
clinical reference answers with appropriate sourcing. 4. Suggest ICD-10
codes and descriptions for verification. 5. Draft treatment-plan options
for doctor review. 6. Evaluate medication decision support only after
specific clinical safety requirements and testing are established.

**Exit criteria:** Drafts are useful and faithful to the source
information, fabricated clinical details are appropriately controlled,
doctors can review and edit outputs easily, and clinical safety
evaluation supports the intended use.

### Phase 3 --- Ambient Clinical AI

**Goal:** Reduce manual input by adding optional capture of the
consultation.

Potential future capabilities: - Microphone-based consultation
capture. - Speech-to-text and speaker diarization. - Multilingual and
code-switched speech support. - Automatic preparation of draft notes
from the conversation. - Optional speaker identification if validated as
useful. - Hardware configurations suited to different clinic layouts.

This phase is deliberately deferred. It should build on the Clinical
Copilot's existing documentation, approval, privacy and audit workflows
rather than introduce a separate clinical record process.

## 8. Non-Goals and Explicit Boundaries

The initial AI roadmap does **not** aim to:

-   Build two disconnected chatbots with separate, duplicated
    foundations.
-   Give the model unrestricted database or application access.
-   Allow an AI to bypass role-based access controls.
-   Make or finalize clinical decisions autonomously.
-   Issue prescriptions without the doctor's explicit action and
    applicable validation.
-   Treat generated text as verified clinical fact.
-   Require voice signatures, microphones or consultation recording for
    the first releases.
-   Build a complex multi-microphone installation before proving the
    value of text-first clinical assistance.
-   Replace the doctor, receptionist or clinic's existing
    accountability.
-   Promise that AI outputs will always be correct.

## 9. Success Measures

Success should be evaluated separately for the two capabilities.

### Operations Copilot measures

-   Percentage of supported tasks completed successfully.
-   Accuracy of product-help responses.
-   Rate of incorrect, duplicate or unintended actions.
-   Percentage of requests that require unnecessary clarification.
-   Time taken to complete common tasks.
-   User satisfaction and repeat usage.
-   Permission violations and privacy incidents, with a target of zero.

### Clinical Copilot measures

-   Time saved preparing documentation.
-   Percentage of drafts accepted with minor edits versus substantial
    corrections.
-   Faithfulness to doctor-provided information.
-   Frequency of unsupported or fabricated clinical details.
-   Accuracy and usefulness of coding suggestions, as assessed by
    qualified reviewers.
-   Doctor correction and override rates.
-   Usability during the consultation workflow.
-   Clinical safety incidents and inappropriate recommendations.

Usage alone is not sufficient evidence of success. The product must also
measure correctness, user trust, safety and the quality of the final
workflow.

## 10. Key Product Decisions Still to Be Made

This document captures the current direction, but several decisions
require further discussion.

### Operations Copilot

-   Which user roles are in scope for the first release?
-   Which application actions are supported initially?
-   Which actions require confirmation, and can any low-risk actions
    proceed without it?
-   Which product documentation and live data sources are authoritative?
-   What should the assistant do when an action fails or data changes
    between preview and confirmation?

### Clinical Copilot

-   Which clinical note sections and templates should be supported
    first?
-   Which specialties and clinical workflows are in scope for the
    initial evaluation?
-   Which clinical references and coding datasets will be considered
    authoritative?
-   How will generated drafts be represented and approved in the
    existing encounter workflow?
-   What level of medication-related assistance is appropriate for the
    first release?
-   What review and validation process will be required before clinical
    functionality is made broadly available?

### Shared experience

-   Should the global assistant automatically route clinical questions,
    or should the user explicitly enter the Clinical Copilot?
-   How should the interface communicate which capability is active?
-   What context may be retained across conversations, and what should
    remain encounter-specific?
-   What should happen when a request crosses operational and clinical
    boundaries?

### Evaluation and launch

-   What minimum quality thresholds must be met before release?
-   Which test cases represent the highest-risk workflows?
-   How will clinicians and clinic staff participate in testing?
-   What feedback, correction and incident-reporting process will be
    available?

These decisions should be resolved before committing to detailed
implementation architecture.

## 11. Recommended Immediate Next Steps

1.  **Define the Operations Copilot scope.** List the first product
    questions, read-only lookups and actions it must support.
2.  **Map permissions and confirmations.** Document which roles can
    perform each action and where user confirmation is required.
3.  **Define the Clinical Copilot's first use cases.** Start with
    text-based documentation and coding assistance rather than ambient
    audio.
4.  **Identify trusted sources.** Establish the product documentation
    source and the clinical reference sources to be evaluated.
5.  **Define the draft-and-approval workflow.** Ensure that AI-generated
    clinical content cannot silently become a finalized record.
6.  **Create an evaluation set.** Test common tasks, ambiguous requests,
    permission boundaries, failure cases and clinical note fidelity.
7.  **Build incrementally.** Validate one useful workflow at a time
    before broadening the agent's permissions or clinical scope.

## 12. Closing Vision

CliniQ AI's AI strategy should be built around two complementary
outcomes:

-   **Help the clinic run:** Make everyday operations easier through an
    assistant that understands the product and safely performs
    authorized work.
-   **Help the doctor focus:** Reduce documentation burden and make
    relevant clinical information easier to access, while preserving the
    doctor's control over diagnosis, treatment and final records.

The two capabilities should feel like parts of one intelligent product,
supported by a shared foundation and governed by distinct safety
boundaries.

The first step is not to capture every word spoken in a consultation. It
is to build reliable operational assistance and useful, text-first
clinical support. Once those capabilities are trusted, ambient listening
can become a considered extension of the same clinical workflow.

**The guiding principle: AI should make CliniQ AI easier to use and
clinical work easier to manage---without taking control away from the
people responsible for the clinic and its patients.**
