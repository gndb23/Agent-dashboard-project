import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SystemSettings } from "@/components/system-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Health, updates, Claude scheduled tasks and data. Fixes are one click; no terminal needed." />
      <div className="max-w-4xl">
        <SystemSettings />
      </div>
    </>
  );
}
