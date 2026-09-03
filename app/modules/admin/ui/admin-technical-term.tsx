export function AdminTechnicalTerm({
  children,
  explanation,
}: {
  children: string;
  explanation: string;
}) {
  return (
    <abbr className="admin-technical-term" tabIndex={0} title={explanation}>
      {children}
    </abbr>
  );
}
