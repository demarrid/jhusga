import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">

      <div className="flex flex-col items-center justify-center">
        <Image
          width={200}
          height={200}
          src="/logo.png"
          alt="SGA logo"
          priority
        />
        <h1 className="text-xl text-center text-zinc-500  m-8">Site under construction.</h1>
      </div>
    </div>
  );
}
