import { useState, useEffect, useCallback } from 'react';
import type { Course } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface UseCoursesReturn {
  courses: Course[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCourses(): UseCoursesReturn {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getCourses();
      setCourses(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.courses));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCourses(); }, [fetchCourses]);

  return { courses, loading, error, refetch: fetchCourses };
}
