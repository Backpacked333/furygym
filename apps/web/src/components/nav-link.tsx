"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { cx } from "@/components/ui";

/** A sidebar entry that highlights itself when its section is open. */
export function NavLink({ href, label, icon, exact }: { href: string; label: string; icon: IconName; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-3 whitespace-nowrap rounded-xl px-3 text-[15px]",
        active ? "bg-fill font-semibold text-white" : "text-white/85 hover:bg-fill-soft",
      )}
    >
      <Icon name={icon} size={20} className={active ? "text-accent" : "text-white/70"} />
      {label}
    </Link>
  );
}
