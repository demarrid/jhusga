import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center ">

      <div className="relative flex flex-1 flex-col items-center justify-center min-h-full w-full py-12 -mt-4">
        <Image
          src="/home_background.jpg"
          alt=""
          fill
          priority
          className="object-cover -z-10"
        />

        <div className="absolute inset-0 -z-[5] bg-black/40 " />

        <div className="relative z-10 flex flex-col items-center justify-center mt-16">
          <Image width={250} height={250} src="/logo.png" alt="SGA logo" priority />
          <h1 className="text-foreground-950 text-5xl font-serif text-center m-8 ">
            Student Government Association at Johns Hopkins University
          </h1>
        </div>

      </div>
      <div className="py-20 max-w-4xl mx-auto">
        <p className="z-10 text-xl">The Student Government Association (SGA) at Johns Hopkins University is the representative body of undergraduate students. It is a student-run organization that is responsible for representing the interests of the student body to the university administration.</p>
      </div>
    </div>
  );
}
