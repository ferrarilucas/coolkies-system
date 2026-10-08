import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  variant?: "wordmark" | "mark";
  className?: string;
};

const sizes = {
  wordmark: { width: 415, height: 202 },
  mark: { width: 499, height: 500 },
};

export function Logo({ variant = "wordmark", className }: LogoProps) {
  const base = `/brand/cipri-${variant}`;
  const { width, height } = sizes[variant];
  return (
    <>
      <Image
        src={`${base}.svg`}
        alt="Cipri"
        width={width}
        height={height}
        unoptimized
        priority
        className={cn("block w-auto dark:hidden", className)}
      />
      <Image
        src={`${base}-reverse.svg`}
        alt=""
        aria-hidden
        width={width}
        height={height}
        unoptimized
        className={cn("hidden w-auto dark:block", className)}
      />
    </>
  );
}
