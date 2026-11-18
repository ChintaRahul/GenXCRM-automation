import { describe, expect, it } from "vitest";
import { buildTemplateValues, fillKnownPlaceholders } from "../lib/templateValues";
import type { Lead } from "../types";

const baseLead = {
  id: "l1",
  name: "Asha",
  phone: "9999999999",
  email: "asha@example.com",
  course: "MBA",
  location: "Pune",
  assignedTo: { id: "u1", name: "Rohan" },
} as unknown as Lead;

describe("buildTemplateValues", () => {
  it("maps lead, org and rep fields", () => {
    const v = buildTemplateValues(baseLead, { orgName: "Acme", repName: "Me" });
    expect(v).toMatchObject({
      name: "Asha",
      course: "MBA",
      plan: "MBA",
      email: "asha@example.com",
      phone: "9999999999",
      location: "Pune",
      org: "Acme",
      rep: "Rohan",
    });
  });

  it("falls back to the sending rep when the lead is unassigned, and omits empty values", () => {
    const v = buildTemplateValues({ ...baseLead, assignedTo: undefined, email: "", course: undefined }, { repName: "Me" });
    expect(v.rep).toBe("Me");
    expect(v).not.toHaveProperty("email");
    expect(v).not.toHaveProperty("course");
    expect(v).not.toHaveProperty("plan");
    expect(v).not.toHaveProperty("org");
  });

  it("uses the latest payment for amount and payment link", () => {
    const lead = {
      ...baseLead,
      payments: [
        { id: "p1", amount: 1000, paymentLink: "https://old", createdAt: "2026-01-01", installments: [] },
        { id: "p2", amount: 25000, paymentLink: "https://new", createdAt: "2026-03-01", installments: [] },
      ],
    } as unknown as Lead;
    const v = buildTemplateValues(lead);
    expect(v.amount).toBe("25000");
    expect(v.payment_link).toBe("https://new");
  });

  it("uses the next unpaid installment for amount, number and due date", () => {
    const lead = {
      ...baseLead,
      payments: [
        {
          id: "p1",
          amount: 30000,
          paymentLink: "https://pay",
          createdAt: "2026-01-01",
          installments: [
            { id: "i1", amount: 10000, dueDate: "2026-02-01", status: "PAID" },
            { id: "i2", amount: 10000, dueDate: "2026-03-05", status: "PENDING" },
            { id: "i3", amount: 10000, dueDate: "2026-04-05", status: "PENDING" },
          ],
        },
      ],
    } as unknown as Lead;
    const v = buildTemplateValues(lead);
    expect(v.installment_no).toBe("2");
    expect(v.amount).toBe("10000");
    expect(v.due_date).toBe(new Date("2026-03-05").toLocaleDateString("en-IN"));
  });
});

describe("link, plan and amount defaults", () => {
  const plan = { name: "Pro", pricePerUser: 499, minUsers: 3 };

  it("uses the org website for link, and omits it when there is none", () => {
    expect(buildTemplateValues(baseLead, { orgWebsite: "https://acme.in" }).link).toBe("https://acme.in");
    expect(buildTemplateValues(baseLead)).not.toHaveProperty("link");
  });

  it("defaults plan to the single platform plan and amount to price x minimum users", () => {
    const v = buildTemplateValues(baseLead, { defaultPlan: plan });
    expect(v.plan).toBe("Pro");
    expect(v.amount).toBe("1497");
    expect(v.course).toBe("MBA"); // course itself is unchanged
  });

  it("prefers the lead's own billing over the default plan price", () => {
    const lead = {
      ...baseLead,
      payments: [{ id: "p1", amount: 25000, createdAt: "2026-01-01", installments: [] }],
    } as unknown as Lead;
    expect(buildTemplateValues(lead, { defaultPlan: plan }).amount).toBe("25000");
  });

  it("keeps the lead's course as plan when there is no default plan", () => {
    expect(buildTemplateValues(baseLead, { defaultPlan: null }).plan).toBe("MBA");
    expect(buildTemplateValues(baseLead, { defaultPlan: null })).not.toHaveProperty("amount");
  });
});

describe("fillKnownPlaceholders", () => {
  it("replaces known placeholders and keeps unknown ones visible", () => {
    expect(fillKnownPlaceholders("Hi {{name}}, {{amount}}", { name: "Asha" })).toBe("Hi Asha, {{amount}}");
  });
});
