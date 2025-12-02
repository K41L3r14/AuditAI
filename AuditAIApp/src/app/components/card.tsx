import React from "react";

type CardProps = {
  className?: string;
  children: React.ReactNode;
};

export function Card({ className = "", children }: CardProps) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}

type CardContentProps = {
  className?: string;
  children: React.ReactNode;
};

export function CardContent({ className = "", children }: CardContentProps) {
  return <div className={`card-content ${className}`.trim()}>{children}</div>;
}
