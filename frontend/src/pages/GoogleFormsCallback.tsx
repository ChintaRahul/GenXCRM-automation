import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useGoogleConnection } from "../hooks/useGoogleConnection";
import { Messages } from "../lib/messages";
import type { GoogleFormsOAuthMessage } from "../types";

type Phase = "working" | "success" | "error";

// Google redirects the OAuth popup here. We bind the single-use code/state to the logged-in
// user, tell the opener window the result, and close. Never log or render code/state.
export default function GoogleFormsCallbackPage() {
  const { complete } = useGoogleConnection();
  const navigate = useNavigate();
  const ran = useRef(false);
  const [phase, setPhase] = useState<Phase>("working");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const finish = (status: GoogleFormsOAuthMessage["status"], message?: string) => {
      setPhase(status);
      if (window.opener) {
        const msg: GoogleFormsOAuthMessage = { type: "genxcrm-google-forms", status, message };
        window.opener.postMessage(msg, window.location.origin);
        window.close();
      } else {
        navigate("/integrations", { replace: true });
      }
    };

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (params.get("error") || !code || !state) {
      finish("error", Messages.googleForms.connectFailed);
      return;
    }
    void (async () => {
      const ok = await complete(code, state);
      if (ok) finish("success");
      else finish("error", Messages.googleForms.connectFailed);
    })();
  }, [complete, navigate]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm font-medium">
        {phase === "working" && "Connecting Google…"}
        {phase === "success" && "Google connected. You can close this window."}
        {phase === "error" && Messages.googleForms.connectFailed}
      </p>
      {phase !== "working" && (
        <Link to="/integrations" className="text-sm text-primary hover:underline">
          Back to Integrations
        </Link>
      )}
    </div>
  );
}
