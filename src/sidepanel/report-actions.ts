export async function copyReport(report: string): Promise<void> {
  await navigator.clipboard.writeText(report);
}

export function downloadReport(report: string, incidentId: string): void {
  const url = URL.createObjectURL(
    new Blob([report], { type: 'text/markdown;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `scope-incident-${incidentId}.md`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
