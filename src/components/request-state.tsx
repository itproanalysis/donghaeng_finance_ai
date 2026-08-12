import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

interface LoadingStateProps {
  title: string;
  description: string;
}

export function LoadingState({ title, description }: LoadingStateProps) {
  return (
    <div className="request-state" role="status" aria-live="polite">
      <LoaderCircle className="spin request-state__icon" size={28} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry: () => void;
  retrying?: boolean;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <div className="request-state request-state--error" role="alert">
      <AlertCircle className="request-state__icon" size={28} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{description}</p>
      <button
        className="button button--secondary"
        type="button"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <RefreshCw size={17} aria-hidden="true" />
        )}
        다시 시도
      </button>
    </div>
  );
}
