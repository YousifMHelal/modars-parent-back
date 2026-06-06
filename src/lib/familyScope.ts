// Shared family-scope guard for per-child writes (research.md §1, Principle I).
//
// Re-exports the Phase 3 `assertChildInFamily` so write modules depend on a
// shared `lib` location rather than reaching into the dashboard module. The
// guard loads the child with a combined { id, familyId, deletedAt: null } where,
// so a foreign / missing / soft-deleted childId is an indistinguishable 404 —
// never another family's row, and never an editable soft-deleted child (FR-019).

export { assertChildInFamily } from "../modules/dashboard/dashboard.service.js";
