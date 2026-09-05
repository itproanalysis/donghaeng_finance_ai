import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

interface LoadingStateProps {
  title: string;
  description: string;
  headingLevel?: 1 | 2;
}

export function LoadingState({ title, description, headingLevel = 1 }: LoadingStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="request-state" role="status" aria-live="polite">
      <LoaderCircle className="spin request-state__icon" size={28} aria-hidden="true" />
      <Heading>{title}</Heading>
      <p>{description}</p>
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry: () => void;
  retrying?: boolean;
  headingLevel?: 1 | 2;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  headingLevel = 1,
}: ErrorStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="request-state request-state--error" role="alert">
      <AlertCircle className="request-state__icon" size={28} aria-hidden="true" />
      <Heading>{title}</Heading>
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
