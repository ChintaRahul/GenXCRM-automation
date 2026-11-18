import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Catches render errors inside routed page content. Without this, an uncaught error
// anywhere in a page (e.g. Reports) unmounts the whole <Outlet /> subtree — including that
// page's own <Header /> and its mobile back button — leaving a blank/black, unresponsive
// screen with no way back (see SCRUM-32, SCRUM-33). Layout.tsx keys this by route pathname
// so navigating to a different page always gets a fresh boundary.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Page crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full min-h-[60vh] px-6 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <p className="text-base font-semibold text-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            This page ran into an error. Go back to the dashboard and try again.
          </p>
          <a
            href="/"
            className="mt-1 inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:opacity-90 transition-opacity"
          >
            Go to Dashboard
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
