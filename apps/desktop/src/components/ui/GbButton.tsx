import type { ButtonHTMLAttributes, ReactNode } from "react";

type GbButtonVariant = "default" | "primary" | "danger" | "ghost" | "subtle";
type GbButtonSize = "sm" | "md" | "lg";

export function GbButton({
  variant = "default",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GbButtonVariant;
  size?: GbButtonSize;
  children?: ReactNode;
}) {
  const variantClass =
    variant === "primary"
      ? "primary"
      : variant === "danger"
        ? "danger"
        : variant === "ghost"
          ? "ghost"
          : variant === "subtle"
            ? "subtle"
            : "";
  const sizeClass = size !== "md" ? `size-${size}` : "";
  return (
    <button
      type="button"
      className={["gb-button", variantClass, sizeClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
