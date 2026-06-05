import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Structural audit: every primary family-owned model exposes a non-null familyId,
 * Parent and Child are distinct entities with no shared identity column,
 * Child has no email, and usernameNormalized is uniquely constrained.
 */
describe("family-scope audit", () => {
  it("every primary family-owned model has a familyId field in its DMMF", () => {
    const familyOwnedModels = [
      "Parent",
      "Child",
      "Session",
      "SubjectProgress",
      "Homework",
      "ReminderConfig",
      "Badge",
      "Notification",
      "Reward",
      "Conversation",
      "ConsentRecord",
    ];

    for (const modelName of familyOwnedModels) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
      expect(model, `Model ${modelName} not found in DMMF`).toBeDefined();

      const familyIdField = model!.fields.find((f) => f.name === "familyId");
      expect(familyIdField, `${modelName} is missing familyId field`).toBeDefined();
      expect(familyIdField!.isRequired, `${modelName}.familyId must be non-nullable`).toBe(true);
    }
  });

  it("Parent and Child are distinct models with no shared identity column", () => {
    const parentModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Parent");
    const childModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Child");

    expect(parentModel).toBeDefined();
    expect(childModel).toBeDefined();

    // Parent is email-based
    expect(parentModel!.fields.find((f) => f.name === "email")).toBeDefined();

    // Child has no email
    expect(childModel!.fields.find((f) => f.name === "email")).toBeUndefined();

    // Child is username-based
    expect(childModel!.fields.find((f) => f.name === "username")).toBeDefined();
    expect(childModel!.fields.find((f) => f.name === "usernameNormalized")).toBeDefined();
  });

  it("Child.usernameNormalized is uniquely constrained", () => {
    const childModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Child");
    expect(childModel).toBeDefined();

    const usernameNormalized = childModel!.fields.find((f) => f.name === "usernameNormalized");
    expect(usernameNormalized, "usernameNormalized field missing").toBeDefined();
    expect(usernameNormalized!.isUnique, "usernameNormalized must be @unique").toBe(true);
  });

  it("Subscription has a familyId field (one subscription per family)", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "Subscription");
    expect(model).toBeDefined();

    const familyIdField = model!.fields.find((f) => f.name === "familyId");
    expect(familyIdField).toBeDefined();
    expect(familyIdField!.isRequired).toBe(true);
    expect(familyIdField!.isUnique).toBe(true);
  });
});
