"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Force the busy state.
   *
   * Only needed when the work is not the click handler's own promise — a form
   * submit, or a handler that fires and forgets. A handler that returns a
   * promise is tracked without this.
   */
  loading?: boolean
}

/**
 * The button also guards against being pressed twice.
 *
 * Anything the user can press that starts network work can be pressed again
 * before it finishes, and on a phone a slow response invites exactly that — a
 * second order, a second listing, a second withdrawal. Guarding it at every one
 * of the app's ~120 call sites means guarding it at 119 of them and finding the
 * last one in production, so it is guarded here instead, once, including for
 * buttons written later.
 *
 * When the click handler returns a promise the button disables itself and shows
 * a spinner until that promise settles, and ignores further presses in the
 * meantime. Handlers that manage their own state keep working: an explicit
 * `disabled` or `loading` still wins.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, onClick, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const [pending, setPending] = React.useState(false)
    const pendingRef = React.useRef(false)

    // A promise can settle after the button has gone — a dialog that closes on
    // success, a row that disappears. Writing state then is a no-op React warns
    // about, so stop tracking once unmounted.
    const mounted = React.useRef(true)
    React.useEffect(() => {
      // Strict Mode runs an extra setup -> cleanup -> setup cycle in
      // development. Reset the flag during setup so the simulated cleanup
      // cannot leave a still-mounted button permanently pending.
      mounted.current = true
      return () => { mounted.current = false }
    }, [])

    const busy = Boolean(loading || pending)
    const blocked = Boolean(disabled || busy)

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        // The second press of a double-tap never reaches the handler.
        if (blocked || pendingRef.current) {
          event.preventDefault()
          return
        }

        const result = onClick?.(event) as unknown
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          // State drives the visuals, while the ref closes the smaller window
          // before React commits that state and disables the DOM button.
          pendingRef.current = true
          setPending(true)
          Promise.resolve(result).then(
            () => {
              pendingRef.current = false
              if (mounted.current) setPending(false)
            },
            () => {
              pendingRef.current = false
              if (mounted.current) setPending(false)
            },
          )
        }
      },
      [blocked, onClick],
    )

    // Slot renders the child element itself and accepts exactly one child, so a
    // spinner cannot be added around it. The press guard still applies.
    //
    // `disabled` is deliberately not forwarded here: asChild is overwhelmingly
    // used to wrap a Link, and `disabled` is not a valid attribute on an anchor
    // — React warns, and it would do nothing anyway. `aria-disabled` states it
    // for assistive tech and the click guard is what actually stops the press.
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }), blocked && "pointer-events-none opacity-50")}
          ref={ref}
          aria-busy={busy || undefined}
          aria-disabled={blocked || undefined}
          onClick={handleClick}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        aria-busy={busy || undefined}
        disabled={blocked}
        onClick={handleClick}
        {...props}
      >
        {/* An icon button is a single glyph in a 40px box: adding a spinner
            beside it would crowd it, so the spinner takes its place. */}
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy && size === "icon" ? null : children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
