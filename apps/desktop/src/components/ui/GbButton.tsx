import type { ButtonHTMLAttributes, ReactNode } from "react";

type GbButtonVariant = "default" | "primary" | "danger" | "ghost";

export function GbButton({
  variant = "default",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GbButtonVariant;
  children?: ReactNode;
}) {
  const variantClass =
    variant === "primary"
      ? "primary"
      : variant === "danger"
        ? "danger"
        : variant === "ghost"
          ? "ghost"
          : "";
  return (
    <button
      type="button"
      className={["gb-button", variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
