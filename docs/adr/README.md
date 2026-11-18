# Architecture decision records

One file per decision: `NNNN-short-title.md`, status **Proposed → Accepted → Superseded/Deprecated**.
Agents may *propose* an ADR; only the PO accepts it (at a gate, after an isolated Claude review).
An implementation task must not change an accepted decision — it stops and proposes a new ADR instead.

The 19 v2 decisions were first written together in [`docs/v2/ARCHITECTURE_DECISIONS.md`](../v2/ARCHITECTURE_DECISIONS.md).
They move into this folder one by one as each is ratified. Rulings that changed them are in
[`docs/v2/VERIFICATION_LOG.md`](../v2/VERIFICATION_LOG.md) (for example C18: one database function per
atomic flow replaces ADR-003's Kysely approach).

| ADR | Title | Status |
|---|---|---|
| [0005](0005-confine-service-role-client.md) | Confine the service-role client; no overrides in server actions | Accepted (G0, 2026-11-11); A1 (V2-01); A2, A3 (V2-04, 2026-11-14, CTO under PO delegation, PO sees at the V2-04 gate) |

Template: [`0000-template.md`](0000-template.md).
