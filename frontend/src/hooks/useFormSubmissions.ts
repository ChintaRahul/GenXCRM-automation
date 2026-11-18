import { useCallback, useEffect, useRef, useState } from "react";
import { getFormSubmissions } from "../api/client";
import type { FormSubmissionDto } from "../types";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface State {
  key: string;
  submissions: FormSubmissionDto[];
  loading: boolean;
  error: string | null;
}

export function useFormSubmissions(query: {
  leadId?: string;
  formId?: string;
}) {
  const { leadId, formId } = query;
  const key = `${leadId ?? ""}|${formId ?? ""}`;
  const [state, setState] = useState<State>({ key, submissions: [], loading: true, error: null });
  const latestRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    const requestId = ++latestRequest.current;
    // Only the latest request for the current lead/form may write state.
    const isCurrent = () => mounted.current && requestId === latestRequest.current;
    try {
      const submissions = await getFormSubmissions({
        ...(leadId && { leadId }),
        ...(formId && { formId }),
      });
      if (isCurrent()) setState({ key, submissions, loading: false, error: null });
    } catch (err) {
      if (isCurrent()) {
        setState((prev) => ({
          key,
          submissions: prev.key === key ? prev.submissions : [],
          loading: false,
          error: apiErrorMessage(err, Messages.googleForms.submissionsFailed),
        }));
      }
    }
  }, [leadId, formId, key]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Data belonging to a previous lead/form is never exposed for the new one.
  const current = state.key === key ? state : { submissions: [], loading: true, error: null };
  return { submissions: current.submissions, loading: current.loading, error: current.error, refetch };
}
