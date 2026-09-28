export function VideoPlayer({ src }: { src: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black shadow-lg shadow-black/40">
      <video key={src} src={src} controls playsInline className="max-h-[70vh] w-full bg-black" />
    </div>
  );
}
