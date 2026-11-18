import type { Course } from "../types";

// A lead-sourced course with no fee or no batches yet needs an admin to finish setting it
// up before it's usable — shared by Courses.tsx's banner/KPI and CourseTable.tsx's status
// pill so the two never silently drift out of sync on what "needs setup" means.
export function courseNeedsSetup(course: Course): boolean {
  return course.source === "LEAD" && (!course.defaultPrice || course.batches.length === 0);
}
