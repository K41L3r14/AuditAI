import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
};

export function Button({ className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`btn btn-primary ${className}`.trim()}
      type={props.type ?? "button"}
      {...props}
    >
      {children}
    </button>
  );
}
