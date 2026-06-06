import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Structural audit: every primary family-owned model exposes a non-null familyId,
 * Parent and Child are distinct entities with no shared identity column,
 * Child has no email, and usernameNormalized is uniquely constrained.
 *
 * Prisma v7 removed the runtime `Prisma.dmmf` accessor, so this audit parses
 * `schema.prisma` directly instead of introspecting the generated client.
 */

const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
const schema = readFileSync(schemaPath, "utf8");

interface FieldInfo {
  name: string;
  isRequired: boolean;
  isUnique: boolean;
  isId: boolean;
}

function parseModel(name: string): { fields: FieldInfo[]; uniqueIndexes: string[][] } | null {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) return null;
  const body = match[1]!;
  const fields: FieldInfo[] = [];
  const uniqueIndexes: string[][] = [];

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    if (line.startsWith("@@unique")) {
      const inner = line.match(/@@unique\(\[([^\]]+)\]/);
      if (inner) uniqueIndexes.push(inner[1]!.split(",").map((s) => s.trim()));
      continue;
    }
    if (line.startsWith("@@")) continue;

    const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\??|\[\])?/);
    if (!fieldMatch) continue;
    const fieldName = fieldMatch[1]!;
    const optionalMarker = fieldMatch[3] ?? "";

    fields.push({
      name: fieldName,
      isRequired: optionalMarker !== "?" && optionalMarker !== "[]",
      isUnique: /@unique\b/.test(line),
      isId: /@id\b/.test(line),
    });
  }

  return { fields, uniqueIndexes };
}

describe("family-scope audit", () => {
  it("every primary family-owned model has a non-null familyId field", () => {
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
      "CoParentInvitation",
    ];

    for (const modelName of familyOwnedModels) {
      const model = parseModel(modelName);
      expect(model, `Model ${modelName} not found in schema`).not.toBeNull();

      const familyIdField = model!.fields.find((f) => f.name === "familyId");
      expect(familyIdField, `${modelName} is missing familyId field`).toBeDefined();
      expect(familyIdField!.isRequired, `${modelName}.familyId must be non-nullable`).toBe(true);
    }
  });

  it("Parent and Child are distinct models with no shared identity column", () => {
    const parentModel = parseModel("Parent");
    const childModel = parseModel("Child");

    expect(parentModel).not.toBeNull();
    expect(childModel).not.toBeNull();

    // Parent is email-based
    expect(parentModel!.fields.find((f) => f.name === "email")).toBeDefined();

    // Child has no email
    expect(childModel!.fields.find((f) => f.name === "email")).toBeUndefined();

    // Child is username-based
    expect(childModel!.fields.find((f) => f.name === "username")).toBeDefined();
    expect(childModel!.fields.find((f) => f.name === "usernameNormalized")).toBeDefined();
  });

  it("Child.usernameNormalized is uniquely constrained", () => {
    const childModel = parseModel("Child");
    expect(childModel).not.toBeNull();

    const usernameNormalized = childModel!.fields.find((f) => f.name === "usernameNormalized");
    expect(usernameNormalized, "usernameNormalized field missing").toBeDefined();
    expect(usernameNormalized!.isUnique, "usernameNormalized must be @unique").toBe(true);
  });

  it("Subscription has a unique, non-null familyId (one subscription per family)", () => {
    const model = parseModel("Subscription");
    expect(model).not.toBeNull();

    const familyIdField = model!.fields.find((f) => f.name === "familyId");
    expect(familyIdField).toBeDefined();
    expect(familyIdField!.isRequired).toBe(true);
    expect(familyIdField!.isUnique).toBe(true);
  });
});
