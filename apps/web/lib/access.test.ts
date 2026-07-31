import { describe, expect, it } from "vitest";

import { openFgaRelationForPermission, permissionsForRole } from "./access";

describe("workspace access roles", () => {
  it("gives co-steerers editing, terminal, and merge capability", () => {
    expect(permissionsForRole("co_steer")).toMatchObject({
      edit: true,
      coSteer: true,
      review: true,
      terminal: true,
      terminalWrite: true,
      merge: true,
    });
  });

  it("keeps reviewers read-only while allowing terminal inspection", () => {
    expect(permissionsForRole("reviewer")).toMatchObject({
      view: true,
      edit: false,
      coSteer: false,
      review: true,
      terminal: true,
      terminalWrite: false,
      merge: false,
    });
  });

  it("keeps viewers read-only", () => {
    expect(permissionsForRole("viewer")).toMatchObject({
      view: true,
      edit: false,
      coSteer: false,
      review: false,
      terminal: false,
      merge: false,
    });
  });

  it("maps every capability to an OpenFGA relation", () => {
    expect(openFgaRelationForPermission("view")).toBe("viewer");
    expect(openFgaRelationForPermission("terminal")).toBe("reviewer");
    expect(openFgaRelationForPermission("review")).toBe("reviewer");
    expect(openFgaRelationForPermission("edit")).toBe("editor");
    expect(openFgaRelationForPermission("coSteer")).toBe("editor");
    expect(openFgaRelationForPermission("terminalWrite")).toBe("editor");
    expect(openFgaRelationForPermission("merge")).toBe("editor");
    expect(openFgaRelationForPermission("invite")).toBe("owner");
  });
});
