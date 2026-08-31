'use client'
import Link from "next/link";
import { getSessionString } from "../utils";
import Image from "next/image";
import { useState } from "react";

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  return (
    <header className=" w-full px-6 py-5 bg-primary-400 uppercase font-medium flex flex-row justify-between sticky top-0 z-50 shadow-md">
      <div className="flex flex-row items-center space-x-4">
        <Link href="/">
          <Image src="/logo.png" alt="SGA logo" width={100} height={100} draggable={false} className="w-[60px] h-[60px] select-none " />
        </Link>
        <h1 className="font-serif text-3xl">The {getSessionString()} Student Government Association</h1>
      </div>

      <nav className="flex flex-row justify-between space-x-4 my-auto text-lg">
        <Link href="/people">FAQ</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/about">About</Link>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="px-4">
          <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g id="style=stroke">
              <g id="menu-hamburger">
                <path id="vector (Stroke)" fillRule="evenodd" clipRule="evenodd" d="M2.25 6C2.25 5.58579 2.58579 5.25 3 5.25H21C21.4142 5.25 21.75 5.58579 21.75 6C21.75 6.41421 21.4142 6.75 21 6.75H3C2.58579 6.75 2.25 6.41421 2.25 6Z" fill="#000000" />
                <path id="vector (Stroke)_2" fillRule="evenodd" clipRule="evenodd" d="M2.25 12C2.25 11.5858 2.58579 11.25 3 11.25H21C21.4142 11.25 21.75 11.5858 21.75 12C21.75 12.4142 21.4142 12.75 21 12.75H3C2.58579 12.75 2.25 12.4142 2.25 12Z" fill="#000000" />
                <path id="vector (Stroke)_3" fillRule="evenodd" clipRule="evenodd" d="M2.25 18C2.25 17.5858 2.58579 17.25 3 17.25H21C21.4142 17.25 21.75 17.5858 21.75 18C21.75 18.4142 21.4142 18.75 21 18.75H3C2.58579 18.75 2.25 18.4142 2.25 18Z" fill="#000000" />
              </g>
            </g>
          </svg>
        </button>
      </nav>
    </header>
  );
}