import Link from "next/link";

/**
 * Wordmark. Rendered as text rather than an image so it stays crisp at any size
 * and inherits the current colour — the same mark works on the light auth card
 * and the dark app header without a second asset.
 */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      <span style={{ color: "var(--brand)" }}>My</span>
      <span>Qare</span>
    </span>
  );
}

export function BrandLink({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`no-underline ${className}`} style={{ color: "var(--text)" }}>
      <Brand />
    </Link>
  );
}
