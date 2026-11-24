"use client";

import { cloneElement, isValidElement, useId, type ReactNode, type ReactElement } from "react";
import { Icon } from "./icons";
import dynamic from "next/dynamic";

export function Field({ label, children, full = false, description, error, field }: { label: string; children: ReactNode; full?: boolean; description?: ReactNode; error?: string; field?: string }) {
  const id = useId();
  const input = isValidElement(children) ? children as ReactElement<{ id?: string; name?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "data-field"?: string }> : null;
  const fieldName = field ?? input?.props.name;
  const enhanced = input ? cloneElement(input, { id, ...(fieldName ? { "data-field": fieldName } : {}), ...(description || error ? { "aria-describedby": [input.props["aria-describedby"], description ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") } : {}), ...(error ? { "aria-invalid": true } : {}) }) : children;
  return <div className={`os-field${full ? " full" : ""}`}><span><label htmlFor={id}>{label}</label></span>{enhanced}{description && <small id={`${id}-help`} className="os-field-help">{description}</small>}{error && <p id={`${id}-error`} className="os-field-error" role="alert">{error}</p>}</div>;
}

export function EmptyState({ title, text, action, onAction, icon = "mail" }: { title: string; text: string; action?: string; onAction?: () => void; icon?: "mail" | "contacts" | "activity" | "sending" | "search" }) {
  return <div className="os-empty"><span className="empty-mark"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{text}</p>{action && <button className="os-button" onClick={onAction}>{action}<Icon name="arrow" size={16} /></button>}</div>;
}

export { CampaignComposer as Compose } from "../campaign-builder/campaign-composer";

export const Contacts = dynamic(() => import("../audience/audience-centre").then(module => module.AudienceCentre), { loading: () => <div className="table-skeleton" role="status" aria-label="Loading audience management"><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div> });

export { EmailSetup } from "./email-setup";
