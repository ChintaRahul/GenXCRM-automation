import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Course, CourseCategory } from "../types";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface UseCourseCatalogReturn {
  courses: Course[];
  loading: boolean;
  error: string | null;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  refetch: () => void;
  addCourse: (payload: {
    name: string;
    category?: CourseCategory;
    defaultPrice: number;
  }) => Promise<Course | undefined>;
  updateCourse: (
    id: string,
    patch: { name?: string; category?: CourseCategory; defaultPrice?: number; isActive?: boolean },
  ) => Promise<void>;
  removeCourse: (id: string) => Promise<void>;
  addBatch: (
    courseId: string,
    payload: {
      label: string;
      schedule: string;
      tutorId?: string;
      capacity: number;
    },
  ) => Promise<void>;
  removeBatch: (courseId: string, batchId: string) => Promise<void>;
}

export function useCourseCatalog(): UseCourseCatalogReturn {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const coursesResult = await client.getCourses(includeArchived);
      setCourses(coursesResult);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.courses));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const addCourse = useCallback(
    async (payload: { name: string; category?: CourseCategory; defaultPrice: number }) => {
      try {
        const created = await client.createCourse(payload);
        await fetchAll();
        toast.success(Messages.courses.created);
        return created;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.courses.createFailed));
        return undefined;
      }
    },
    [fetchAll],
  );

  const updateCourse = useCallback(
    async (
      id: string,
      patch: {
        name?: string;
        category?: CourseCategory;
        defaultPrice?: number;
        isActive?: boolean;
      },
    ) => {
      try {
        await client.updateCourse(id, patch);
        await fetchAll();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.courses.updateFailed));
      }
    },
    [fetchAll],
  );

  const removeCourse = useCallback(
    async (id: string) => {
      try {
        await client.deleteCourse(id);
        await fetchAll();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.courses.removeFailed));
      }
    },
    [fetchAll],
  );

  const addBatch = useCallback(
    async (
      courseId: string,
      payload: {
        label: string;
        schedule: string;
        tutorId?: string;
        capacity: number;
      },
    ) => {
      try {
        await client.addBatch(courseId, payload);
        await fetchAll();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.courses.addBatchFailed));
      }
    },
    [fetchAll],
  );

  const removeBatch = useCallback(
    async (courseId: string, batchId: string) => {
      try {
        await client.removeBatch(courseId, batchId);
        await fetchAll();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.courses.removeBatchFailed));
      }
    },
    [fetchAll],
  );

  return {
    courses,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    refetch: fetchAll,
    addCourse,
    updateCourse,
    removeCourse,
    addBatch,
    removeBatch,
  };
}
