import { useCallback, useEffect, useState } from "react";
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  copyTemplate,
  submitTemplate,
  refreshWhatsappTemplates,
} from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { MessageTemplate } from "../types";

interface UseTemplatesReturn {
  templates: MessageTemplate[];
  loading: boolean;
  error: string | null;
  create: (payload: Record<string, unknown>) => Promise<MessageTemplate>;
  update: (id: string, payload: Record<string, unknown>) => Promise<MessageTemplate>;
  remove: (id: string) => Promise<void>;
  copy: (id: string) => Promise<MessageTemplate>;
  submit: (id: string) => Promise<MessageTemplate>;
  refreshWhatsapp: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useTemplates(): UseTemplatesReturn {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setTemplates(await getTemplates());
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.templates));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const create = useCallback(
    async (payload: Record<string, unknown>) => {
      const created = await createTemplate(payload);
      await fetchTemplates();
      return created;
    },
    [fetchTemplates],
  );

  const update = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const updated = await updateTemplate(id, payload);
      await fetchTemplates();
      return updated;
    },
    [fetchTemplates],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteTemplate(id);
      await fetchTemplates();
    },
    [fetchTemplates],
  );

  const copy = useCallback(
    async (id: string) => {
      const copied = await copyTemplate(id);
      await fetchTemplates();
      return copied;
    },
    [fetchTemplates],
  );

  const submit = useCallback(
    async (id: string) => {
      const submitted = await submitTemplate(id);
      await fetchTemplates();
      return submitted;
    },
    [fetchTemplates],
  );

  const refreshWhatsapp = useCallback(async () => {
    await refreshWhatsappTemplates();
    await fetchTemplates();
  }, [fetchTemplates]);

  return {
    templates,
    loading,
    error,
    create,
    update,
    remove,
    copy,
    submit,
    refreshWhatsapp,
    refetch: fetchTemplates,
  };
}
