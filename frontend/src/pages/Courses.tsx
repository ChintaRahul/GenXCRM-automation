import { LoadError } from "../components/shared/LoadError";
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/shared/EmptyState";
import { StatCard } from "../components/shared/StatCard";
import { CourseTable } from "../components/courses/CourseTable";
import { AddCourseModal } from "../components/courses/AddCourseModal";
import { TutorsTab } from "../components/courses/TutorsTab";
import { useCourseCatalog } from "../hooks/useCourseCatalog";
import { useTutors } from "../hooks/useTutors";
import { courseNeedsSetup } from "../lib/courseStatus";
import type { CourseCategory } from "../types";

const TABS = [
  { key: "catalog", label: "Catalog" },
  { key: "tutors", label: "Tutors" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Thin page (CLAUDE.md rule 7) — all data fetching/mutations live in useCourseCatalog
// (catalog tab) and useTutors (tutors tab); KPI/status derivation happens here from the
// raw course list, same as the design prototype's client-side renderVals(), keeping the
// backend a plain CRUD surface.
export default function CoursesPage() {
  const {
    courses,
    loading,
    error,
    refetch,
    includeArchived,
    setIncludeArchived,
    addCourse,
    updateCourse,
    removeCourse,
    addBatch,
    removeBatch,
  } = useCourseCatalog();
  const tutorsTab = useTutors();
  const [tab, setTab] = useState<TabKey>("catalog");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addModalOpen, setAddModalOpen] = useState(false);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleAddCourse = async (payload: {
    name: string;
    category: CourseCategory;
    defaultPrice: number;
  }) => {
    const created = await addCourse(payload);
    if (created) setExpanded((prev) => ({ ...prev, [created.id]: true }));
  };

  // Batches can only be assigned an active tutor, regardless of whether the Tutors tab
  // currently has "Show archived" toggled on.
  const activeTutors = tutorsTab.tutors.filter((t) => t.isActive);

  const totalBatches = courses.reduce((sum, c) => sum + c.batches.length, 0);
  const autoPending = courses.filter(courseNeedsSetup);
  const allBatches = courses.flatMap((c) => c.batches);
  const totalSeats = allBatches.reduce((sum, b) => sum + b.seats, 0);
  const totalCapacity = allBatches.reduce((sum, b) => sum + b.capacity, 0);
  const fillPct =
    totalCapacity > 0 ? Math.round((totalSeats / totalCapacity) * 100) : 0;

  return (
    <>
      <Header
        title="Courses"
        subtitle="Catalog, batches, and tutors — new course names from leads are added here automatically"
        actions={
          tab === "catalog" ? (
            <>
              <Button
                variant="outline"
                onClick={() => setIncludeArchived(!includeArchived)}
              >
                {includeArchived ? "Hide archived" : "Show archived"}
              </Button>
              <Button onClick={() => setAddModalOpen(true)}>+ Add Course</Button>
            </>
          ) : undefined
        }
      />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex gap-1 border-b border-card-border overflow-x-auto overflow-y-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-sm font-medium whitespace-nowrap transition-colors",
                tab === t.key
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground border-b-2 border-transparent",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "tutors" ? (
          <TutorsTab
            tutors={tutorsTab.tutors}
            loading={tutorsTab.loading}
            includeArchived={tutorsTab.includeArchived}
            onToggleArchived={() =>
              tutorsTab.setIncludeArchived(!tutorsTab.includeArchived)
            }
            onAdd={(name) => void tutorsTab.addTutor(name)}
            onUpdate={(id, patch) => void tutorsTab.updateTutor(id, patch)}
          />
        ) : loading ? (
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-card border border-card-border rounded-xl">
            <LoadError message={error} onRetry={refetch} className="py-12" />
          </div>
        ) : courses.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl">
            <EmptyState
              icon={<BookOpen className="w-10 h-10" />}
              title="No courses yet"
              description="Add your first course to start building batches and taking registrations."
              action={
                <Button onClick={() => setAddModalOpen(true)}>+ Add Course</Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <StatCard
                title="Total courses"
                value={courses.length}
                icon={<BookOpen className="w-4 h-4 text-primary" />}
                subtitle={`${courses.length - autoPending.length} active in catalog`}
              />
              <StatCard
                title="Total batches"
                value={totalBatches}
                icon={<BookOpen className="w-4 h-4 text-primary" />}
                subtitle={`${activeTutors.length} tutors assigned`}
              />
              <StatCard
                title="Needs setup"
                value={autoPending.length}
                icon={<BookOpen className="w-4 h-4 text-primary" />}
                subtitle="auto-added from lead intake"
              />
              <StatCard
                title="Seat fill rate"
                value={`${fillPct}%`}
                icon={<BookOpen className="w-4 h-4 text-primary" />}
                subtitle={`${totalSeats} of ${totalCapacity} seats filled`}
              />
            </div>

            {autoPending.length > 0 && (
              <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3.5">
                <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-800 dark:text-amber-400 mb-1">
                    {autoPending.length} course
                    {autoPending.length === 1 ? "" : "s"} auto-added from lead
                    intake
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    A lead mentioned a course that wasn't in your catalog, so it
                    was created automatically. Set a fee and add at least one
                    batch to activate it.
                  </p>
                  <div className="flex gap-1.5 flex-wrap mt-2.5">
                    {autoPending.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [c.id]: true }))
                        }
                        className="h-[27px] max-[767px]:h-11 px-2.5 rounded-full border border-amber-300 dark:border-amber-500/40 bg-card text-amber-800 dark:text-amber-400 text-[11.5px] font-semibold"
                      >
                        {c.name || "Untitled course"} →
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <CourseTable
              courses={courses}
              tutors={activeTutors}
              expanded={expanded}
              onToggleExpand={toggleExpand}
              onUpdate={(id, patch) => void updateCourse(id, patch)}
              onRemove={(id) => void removeCourse(id)}
              onAddBatch={(courseId, payload) =>
                void addBatch(courseId, payload)
              }
              onRemoveBatch={(courseId, batchId) =>
                void removeBatch(courseId, batchId)
              }
              onGoToTutors={() => setTab("tutors")}
            />
          </>
        )}
      </div>

      <AddCourseModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onSubmit={handleAddCourse}
      />
    </>
  );
}
