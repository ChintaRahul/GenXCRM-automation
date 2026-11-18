import { Link } from "react-router-dom";

export const NoAccessPage = () => (
  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <p className="text-5xl font-semibold text-muted-foreground">403</p>
    <p className="text-lg font-medium">You don&apos;t have access to this page</p>
    <p className="text-sm text-muted-foreground">Ask your admin if you need it.</p>
    <Link to="/" className="mt-2 text-sm text-primary hover:underline">
      Go to dashboard
    </Link>
  </div>
);
