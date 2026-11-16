import Link from "next/link";
import { EmptyState } from "@/components/page-header";

export default function NotFound() {
  return (
    <EmptyState title="Not found">
      That agent or run doesn&apos;t exist (yet). <Link href="/" className="text-accent hover:underline">Back to overview</Link>
    </EmptyState>
  );
}
