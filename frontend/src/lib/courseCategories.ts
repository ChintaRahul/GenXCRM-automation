import type { CourseCategory } from "../types";

export const CATEGORY_OPTIONS: { value: CourseCategory; label: string }[] = [
  { value: "TEST_PREP", label: "Test Prep" },
  { value: "LANGUAGE", label: "Language" },
  { value: "TEST_SERIES", label: "Test Series" },
  { value: "PROFESSIONAL_SKILLS", label: "Professional Skills" },
  { value: "OTHER", label: "Other" },
];
