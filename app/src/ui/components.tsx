import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";
import type {
  ComponentPropsWithRef,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
  HTMLAttributes,
  DetailsHTMLAttributes,
} from "react";
export function Button({
  variant,
  pending = false,
  children,
  disabled,
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary";
  pending?: boolean;
}) {
  return (
    <button
      {...props}
      className={`${variant ? `${variant}-button` : props.className ? "" : "primary-button"} ${props.className ?? ""}`}
      disabled={disabled || pending}
      aria-busy={pending || props["aria-busy"]}
    >
      {pending && <span className="update-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <span className="guide-index">{number}</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p className="lead">{children}</p>}
      </div>
    </div>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress-block">
      <p role="status">{label}</p>
      <progress max={7} value={value} aria-label={label} />
    </div>
  );
}
export function ComponentGallery() {
  return (
    <>
      <PageHeader eyebrow="DESIGN SYSTEM" title="Interface foundations">
        Shared components and states used throughout Image Studio.
      </PageHeader>
      <section className="surface-card">
        <h2>Actions</h2>
        <div className="form-actions">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary action</Button>
          <Button disabled>Unavailable</Button>
          <Button pending>Preparing…</Button>
        </div>
      </section>
      <SurfaceCard>
        <h2>Status and feedback</h2>
        <div className="form-actions">
          <StatusBadge>Queued</StatusBadge>
          <StatusBadge tone="success">Ready</StatusBadge>
          <StatusBadge tone="warning">Needs attention</StatusBadge>
        </div>
        <Progress value={3} label="3 of 7 images ready" />
        <ErrorNotice title="API key issue">
          Use a key issued by the selected provider.
        </ErrorNotice>
        <ImagePlaceholder active label="Creating…" />
      </SurfaceCard>
      <div className="guide-list">
        <GuideStep number="01" title="A readable step">
          <p>
            One shared structure keeps the index and content in their intended
            columns.
          </p>
        </GuideStep>
      </div>
    </>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function ImagePlaceholder({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <div className="image-placeholder" data-active={active}>
      <div className="image-placeholder-art" aria-hidden="true">
        <span className="image-placeholder-object" />
        <span className="image-placeholder-ground" />
      </div>
      <span>{label}</span>
    </div>
  );
}

export function ErrorNotice({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="error-notice" role="alert" id={id}>
      <strong className="error-badge">{title}</strong>
      <div>{children}</div>
    </div>
  );
}

export function SurfaceCard({
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`surface-card ${className}`} />;
}
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className="loading-state" role="status">
      <span className="update-spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="image" />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Disclosure(props: DetailsHTMLAttributes<HTMLDetailsElement>) {
  return <details {...props} />;
}
export function DisclosureSummary(props: HTMLAttributes<HTMLElement>) {
  return <summary {...props} />;
}

export function Dialog({
  title,
  onDismiss,
  children,
  closeLabel = "Close",
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null,
      dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="studio-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <Button
          type="button"
          className="icon-button"
          aria-label={closeLabel}
          onClick={onDismiss}
        >
          <Icon name="close" />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
