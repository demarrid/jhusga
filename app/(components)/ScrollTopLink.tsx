"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

type ScrollTopLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
} & Pick<ComponentProps<typeof Link>, "aria-label">;

export default function ScrollTopLink({
  href,
  className,
  children,
  ...rest
}: ScrollTopLinkProps) {
  const pathname = usePathname();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname === href) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <Link className={className} href={href} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
}
