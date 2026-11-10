import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { titleCase } from "@/lib/format";

const nav = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/programming", label: "Programming" },
  { href: "/admin/exercises", label: "Exercises" },
  { href: "/admin/programs", label: "Online programs" },
  { href: "/admin/schedule", label: "Class schedule" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/display", label: "TV display" },
  { href: "/admin/plans", label: "Plans & settings", admin: true },
  { href: "/admin/reports", label: "Reports", admin: true },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const viewer = await requireStaff();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line bg-surface md:w-56 md:border-b-0 md:border-r">
        <div className="px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co.</p>
          <p className="text-sm font-semibold">{viewer.gym.name}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {nav
            .filter((item) => !item.admin || viewer.isAdmin)
            .map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink">
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="hidden border-t border-line px-5 py-4 text-xs text-muted md:block">
          <p className="truncate text-ink">{viewer.profile?.full_name || viewer.user.email}</p>
          <p>{viewer.role ? titleCase(viewer.role) : ""}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="underline hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-8">{children}</main>
    </div>
  );
}
