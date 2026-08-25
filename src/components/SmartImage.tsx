import { useState } from "react";

/**
 * An <img> that degrades gracefully when the file is missing (e.g. the
 * designer's public/img/*.jpg assets aren't live yet). On error it renders a
 * neutral brand-gradient placeholder instead, so the layout stays correct no
 * matter what.
 */
export function SmartImage({
  src,
  alt,
  className,
  fallbackClassName,
  label,
}: {
  src?: string;
  alt: string;
  /** classes applied to the <img> when the file loads */
  className?: string;
  /** classes applied to the gradient fallback container (should include sizing) */
  fallbackClassName?: string;
  /** optional short label shown on the fallback placeholder */
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = Boolean(src) && !failed;

  if (!show) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-gradient-to-br from-brand/25 via-brand/10 to-brand/5 text-center ${fallbackClassName ?? ""}`}
      >
        {label && (
          <span className="px-3 text-sm font-semibold leading-tight text-brand/60">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
