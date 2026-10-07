import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[transform,background-color,border-color,box-shadow,color,opacity] duration-200 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_8px_20px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:-translate-y-px hover:bg-primary/92 hover:shadow-[0_12px_28px_-12px_color-mix(in_oklab,var(--primary)_75%,transparent)] active:translate-y-0",
        outline:
          "border-border/90 bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:-translate-y-px hover:border-primary/35 hover:bg-accent/60 hover:shadow-sm aria-expanded:bg-muted",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground shadow-sm hover:-translate-y-px hover:bg-accent hover:text-accent-foreground",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-white shadow-sm hover:-translate-y-px hover:bg-destructive/90 focus-visible:ring-destructive/20",
        link: "h-auto rounded-none px-0 text-primary underline-offset-4 hover:text-primary/80 hover:underline",
      },
      size: {
        default: "h-11 gap-2 px-4",
        xs: "h-8 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-md px-3 text-[0.82rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-[0.95rem]",
        icon: "size-11",
        "icon-xs": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-md",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
