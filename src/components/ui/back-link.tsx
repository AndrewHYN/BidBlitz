import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export function BackLink({ href, children, className }: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 max-w-full whitespace-normal", className)}>
      <ArrowLeft aria-hidden /> {children}
    </Link>
  );
}
