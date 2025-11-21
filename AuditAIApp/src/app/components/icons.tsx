import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUpload,
  faFileCode,
  faShieldAlt,
  faExclamationTriangle,
  faTimesCircle,
  faChartBar,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";

export type IconProps = { className?: string };

export const Upload = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#60a5fa" }}>
    <FontAwesomeIcon icon={faUpload} />
  </span>
);

export const FileCode = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#9ca3af" }}>
    <FontAwesomeIcon icon={faFileCode} />
  </span>
);

export const ShieldCheck = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#22c55e" }}>
    <FontAwesomeIcon icon={faShieldAlt} />
  </span>
);

export const AlertTriangle = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#facc15" }}>
    <FontAwesomeIcon icon={faExclamationTriangle} />
  </span>
);

export const XCircle = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#f87171" }}>
    <FontAwesomeIcon icon={faTimesCircle} />
  </span>
);

export const BarChart = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#60a5fa" }}>
    <FontAwesomeIcon icon={faChartBar} />
  </span>
);

export const Info = ({ className }: IconProps) => (
  <span className={className} style={{ color: "#93c5fd" }}>
    <FontAwesomeIcon icon={faInfoCircle} />
  </span>
);
