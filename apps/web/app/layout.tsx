import type { Metadata } from "next";
import "./globals.css";
import "./routes.css";
import "./dashboard.css";
import "./email-setup.css";
import "@xyflow/react/dist/style.css";
import "./campaign-builder/builder.css";
import "./notifications.css";
import "./audience/audience.css";
import "./help/help.css";
import { GlobalToaster } from "./dashboard/toaster";

export const metadata: Metadata = { title: "Marketing OS", description: "Private marketing operations dashboard" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=JSON.parse(localStorage.getItem('marketing-os-appearance'));if(p&&(p.theme==='light'||p.theme==='dark')&&/^#[0-9a-f]{6}$/i.test(p.accent)){document.documentElement.dataset.theme=p.theme;document.documentElement.style.setProperty('--accent-color',p.accent)}}catch(e){}})()` }} />{children}<GlobalToaster /></body></html>;
}
