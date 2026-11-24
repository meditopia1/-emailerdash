import type { GuideAction, GuidePage } from "../../../lib/guided-setup";
export type HelpArticle = { id: string; title: string; description: string; page: GuidePage; prerequisites: string[]; instructions: { title: string; text: string }[]; destination: GuideAction; link?: { label: string; href: string } };
