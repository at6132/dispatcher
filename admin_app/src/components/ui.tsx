export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  );
}

export function Empty({ label = 'Nothing here yet.' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error">{message}</div>;
}

export function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls =
    v.includes('lock') ||
    v.includes('den') ||
    v.includes('cancel') ||
    v.includes('fail') ||
    v.includes('critical')
      ? 'danger'
      : v.includes('open') || v.includes('pending') || v.includes('warn')
        ? 'warn'
        : v.includes('settled') ||
            v.includes('active') ||
            v.includes('accepted') ||
            v.includes('completed')
          ? 'ok'
          : '';
  return <span className={`badge ${cls}`.trim()}>{value}</span>;
}
