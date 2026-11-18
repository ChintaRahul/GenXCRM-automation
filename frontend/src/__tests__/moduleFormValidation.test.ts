import { describe, it, expect } from "vitest";
import { validateFields, toPayload, serverFormErrors } from "../lib/moduleFormValidation";
import type { ModuleField } from "../modules/registry";

const fields: ModuleField[] = [
  { key: "company", label: "Company", type: "text", required: true },
  { key: "phone", label: "Phone", type: "text", required: true },
  { key: "email", label: "Email", type: "text" },
  { key: "value", label: "Value", type: "money" },
  { key: "pct", label: "Margin", type: "pct" },
  { key: "product", label: "Product", type: "select", required: true, options: ["Weighbridge", "Conveyor"] },
  { key: "ownerId", label: "Owner", type: "owner", required: true },
];

describe("validateFields", () => {
  it("flags missing required fields with a labelled message, but never the owner", () => {
    const errors = validateFields(fields, { company: "  " });
    expect(errors.company).toBe("Company is required.");
    expect(errors.phone).toBe("Phone is required.");
    expect(errors.product).toBe("Product is required.");
    expect(errors.ownerId).toBeUndefined();
  });

  it("checks email, phone, number and percentage formats", () => {
    const errors = validateFields(fields, { company: "A", phone: "abc", product: "Conveyor", email: "nope", value: "-5", pct: "120" });
    expect(errors.phone).toMatch(/valid phone number/);
    expect(errors.email).toMatch(/valid email/);
    expect(errors.value).toMatch(/negative/);
    expect(errors.pct).toMatch(/more than 100/);
  });

  it("accepts a fully valid set", () => {
    expect(validateFields(fields, { company: "A", phone: "+91 84515 15151", product: "Conveyor", email: "a@b.co", value: "5000" })).toEqual({});
  });
});

describe("toPayload", () => {
  it("trims, converts numeric fields and drops blanks on create", () => {
    expect(toPayload(fields, { company: " A ", value: "5000", email: "", ownerId: "" }, false)).toEqual({ company: "A", value: 5000 });
  });

  it("sends checkboxes as real booleans", () => {
    const bool: ModuleField[] = [{ key: "installRequired", label: "Install", type: "bool" }];
    expect(toPayload(bool, { installRequired: "true" }, false)).toEqual({ installRequired: true });
    expect(toPayload(bool, { installRequired: "" }, true)).toEqual({ installRequired: false });
  });

  it("keeps blanks on edit so a field can be cleared", () => {
    expect(toPayload(fields, { email: "" }, true)).toEqual({ email: "" });
  });
});

describe("serverFormErrors", () => {
  const err = (status: number, message: unknown) => ({ response: { status, data: { message } } });

  it("maps class-validator messages onto fields using their labels", () => {
    const { fields: byField, general } = serverFormErrors(err(400, ["phone should not be empty", "value must be a number conforming to the specified constraints"]), fields);
    expect(byField.phone).toBe("Phone is required.");
    expect(byField.value).toBe("Value must be a number conforming to the specified constraints.");
    expect(general).toBeNull();
  });

  it("turns unknown-property rejections into a message on the field, hiding system properties", () => {
    const { fields: byField, general } = serverFormErrors(err(400, ["property company should not exist", "property orgId should not exist"]), fields);
    expect(byField.company).toMatch(/Company can't be saved from this form/);
    expect(general).toBeNull();
  });

  it("reads messages nested one level deep, as the module API returns them", () => {
    const nested = { response: { status: 400, data: { message: { message: ["property company should not exist"], statusCode: 400 } } } };
    expect(serverFormErrors(nested, fields).fields.company).toMatch(/Company can't be saved/);
  });

  it("explains every other kind of failure in plain words", () => {
    expect(serverFormErrors(err(500, "Internal server error"), fields).general).toMatch(/went wrong on our side/i);
    expect(serverFormErrors(err(403, "Your role does not have 'update' access to 'accounts'."), fields).general).toBe("Your role does not have 'update' access to 'accounts'.");
    expect(serverFormErrors(err(401, "Unauthorized"), fields).general).toMatch(/session has expired/i);
    expect(serverFormErrors(err(404, "Account 'A-9' not found."), fields).general).toBe("Account 'A-9' not found.");
    expect(serverFormErrors(new Error("Network Error"), fields).general).toMatch(/can't reach the server/i);
  });
});
