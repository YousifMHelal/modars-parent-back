import { describe, it, expect } from "vitest";
import { can, type Action } from "../../src/modules/auth/permissions.js";

describe("Permission matrix", () => {
  describe("OWNER role", () => {
    it("can view dashboard", () => expect(can("owner", "dashboard.view")).toBe(true));
    it("can manage children", () => expect(can("owner", "children.create")).toBe(true));
    it("can delete children", () => expect(can("owner", "children.delete")).toBe(true));
    it("can manage billing", () => expect(can("owner", "billing.manage")).toBe(true));
    it("can manage co-parents", () => expect(can("owner", "co_parent.manage")).toBe(true));
    it("can delete family", () => expect(can("owner", "family.delete")).toBe(true));
    it("cannot use child session", () => expect(can("owner", "child.session")).toBe(false));
  });

  describe("CO_PARENT role", () => {
    it("can view dashboard", () => expect(can("co_parent", "dashboard.view")).toBe(true));
    it("can create children", () => expect(can("co_parent", "children.create")).toBe(true));
    it("cannot delete children", () => expect(can("co_parent", "children.delete")).toBe(false));
    it("cannot manage billing", () => expect(can("co_parent", "billing.manage")).toBe(false));
    it("cannot manage co-parents", () => expect(can("co_parent", "co_parent.manage")).toBe(false));
    it("cannot delete family", () => expect(can("co_parent", "family.delete")).toBe(false));
    it("can reset child credentials", () =>
      expect(can("co_parent", "child.credentials")).toBe(true));
    it("cannot use child session", () => expect(can("co_parent", "child.session")).toBe(false));
  });

  describe("CHILD role", () => {
    const parentActions: Action[] = [
      "dashboard.view",
      "children.view",
      "children.create",
      "children.edit",
      "children.delete",
      "children.pause",
      "child.credentials",
      "progress.view",
      "billing.manage",
      "co_parent.manage",
      "account.settings",
      "family.delete",
    ];

    for (const action of parentActions) {
      it(`cannot ${action}`, () => expect(can("child", action)).toBe(false));
    }

    it("can use child.session", () => expect(can("child", "child.session")).toBe(true));
  });
});
