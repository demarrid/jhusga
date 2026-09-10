'use client'
import Image from "next/image";
import Link from "next/link";
import { getSessionString } from "../utils";

export default function Header() {
  return (
    <header className=" w-full px-6 py-5 bg-primary-400 uppercase font-medium flex flex-row justify-between sticky top-0 z-50 shadow-md">
      <div className="flex flex-row items-center space-x-4">
        <Link href="/">
          <Image src="/logo.png" alt="SGA logo" width={100} height={100} draggable={false} className="w-15 h-15 select-none " />
        </Link>
        <a href="/">
          <h1 className="font-serif font-medium text-3xl ">The {getSessionString()} Student Government Association</h1>
        </a>
      </div>

      <nav className="flex flex-row justify-between space-x-4 my-auto text-lg">
        <Link href="/about">About</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/discussion">Discussion</Link>
      </nav>
    </header>
  );
}