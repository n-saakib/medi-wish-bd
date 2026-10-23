import Link from 'next/link';

export function EmptyState({ title, text, href, linkText }: { title: string; text: string; href: string; linkText: string }) {
  return (
    <section className="center empty-state">
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      <Link className="btn btn-secondary btn-sm" href={href}>{linkText}</Link>
    </section>
  );
}
