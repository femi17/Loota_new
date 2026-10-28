import Image, { type StaticImageData } from "next/image";

/**
 * A picture of the game as it looks on a phone (a real screenshot, src/images/landing), in a phone's frame. `className`
 * places and turns the phone (absolute, rotate, a width for small screens with !w-…).
 */
export function PhoneShot({ src, alt, width = 240, priority = false, className = "" }: { src: StaticImageData; alt: string; width?: number; priority?: boolean; className?: string }) {
  return (
    <div className={`shrink-0 ${className}`} style={{ width }}>
      <div className="relative rounded-[34px] bg-[#05070c] p-[7px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
        <Image
          src={src}
          alt={alt}
          placeholder="blur"
          priority={priority}
          sizes={`${width}px`}
          className="block h-auto w-full rounded-[28px]"
          draggable={false}
        />
        {/* The phone's camera */}
        <span className="absolute left-1/2 top-[13px] h-[14px] w-[64px] -translate-x-1/2 rounded-full bg-[#05070c]" aria-hidden="true" />
      </div>
    </div>
  );
}
