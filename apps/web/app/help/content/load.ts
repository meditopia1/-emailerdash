import type { GuidePage } from "../../../lib/guided-setup";
import type { HelpArticle } from "./types";
export async function loadHelpArticles(page: GuidePage): Promise<HelpArticle[]> {
  if (page === "Email Setup") return (await import("./email-setup")).articles;
  if (page === "Contacts") return (await import("./contacts")).articles;
  if (page === "Compose & Send") return (await import("./builder")).articles;
  if (page === "Settings") return (await import("./appearance")).articles;
  if (page === "Suppressions") return (await import("./safeguards")).articles;
  const all = (await import("./operations")).articles;
  return all.filter(article => article.page === page);
}
