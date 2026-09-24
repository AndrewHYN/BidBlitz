import { formatMoney, type Money as MoneyValue } from "@/lib/money";

/**
 * Renders an integer minor-unit amount. Never accepts a float, never parses a
 * string into a Number: `bigint` all the way to the formatter.
 */
export function Money({
  minor,
  currency = "USD",
  compact = false,
  className,
  signed,
}: {
  minor: bigint | number | string | null | undefined;
  currency?: string;
  compact?: boolean;
  className?: string;
  /** Render "+" / "−" prefix (used for deltas like fee previews). */
  signed?: boolean;
}) {
  if (minor === null || minor === undefined) {
    return <span className={className}>—</span>;
  }

  let value: bigint;
  try {
    value = typeof minor === "bigint" ? minor : BigInt(minor);
  } catch {
    return <span className={className}>—</span>;
  }

  const m: MoneyValue = { minor: value, currency: currency.toUpperCase() };
  const text = formatMoney(m, { compact });

  if (!signed || value === 0n) {
    return <span data-numeric className={className}>{text}</span>;
  }

  return (
    <span data-numeric className={className}>
      {value > 0n ? "+" : "−"}
      {formatMoney({ minor: value < 0n ? -value : value, currency: currency.toUpperCase() }, { compact })}
    </span>
  );
}
