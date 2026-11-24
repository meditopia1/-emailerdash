import type { HelpArticle } from "./types";
export const articles: HelpArticle[] = [{ id: "appearance", title: "Choose your theme and accent", description: "Personalize the interface without changing email content or sending settings.", page: "Settings", prerequisites: [], destination: { page: "Settings" }, instructions: [
  { title: "Choose Light or Dark", text: "Select an interface theme. The dashboard, help drawer and contact screens follow the same theme." },
  { title: "Pick an accent", text: "Choose a preset swatch or use Custom accent color. The preview updates immediately; no email is sent and campaign content is unchanged." },
  { title: "Keep or reset your preferences", text: "Appearance is saved on this browser and device. Reset to default restores the original theme and accent. Email setup is a separate settings tab." },
] }];
