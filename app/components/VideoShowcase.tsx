"use client";


interface Video {
  id: string;
  youtubeId: string;
  label: string;
  aspectRatio: "portrait" | "landscape";
}

interface VideoShowcaseProps {
  videos: Video[];
}

export default function VideoShowcase({ videos }: VideoShowcaseProps) {
  const portraitVideos = videos.filter((v) => v.aspectRatio === "portrait");
  const landscapeVideos = videos.filter((v) => v.aspectRatio === "landscape");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left side - Landscape video */}
      <div className="space-y-6">
        {landscapeVideos.map((video) => (
          <div key={video.id} className="group relative">
            {/* Label badge */}
            <div className="absolute -top-3 left-4 z-20 pointer-events-none">
              <span className="inline-block rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white shadow-lg">
                {video.label}
              </span>
            </div>

            {/* Video container */}
            <div
              className="relative overflow-hidden rounded-2xl border border-white/30 backdrop-blur-xl transition-all duration-500 hover:border-accent/40 hover:shadow-2xl hover:shadow-accent/20"
              style={{
                background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                aspectRatio: '16/9'
              }}
            >
              {/* Decorative corner accent */}
              <div className="absolute right-0 top-0 h-20 w-20 opacity-20 pointer-events-none">
                <div className="absolute right-4 top-4 h-12 w-12 rounded-full bg-accent/30 blur-xl" />
              </div>

              <div className="relative h-full w-full p-2 z-10">
                <iframe
                  src={`https://www.youtube.com/embed/${video.youtubeId}?rel=0&modestbranding=1`}
                  title={video.label}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full rounded-xl relative z-10"
                  style={{ border: 'none', pointerEvents: 'auto' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Right side - Portrait videos in grid */}
      <div className="grid grid-cols-3 gap-4">
        {portraitVideos.map((video) => (
          <div key={video.id} className="group relative">
            {/* Label badge */}
            <div className="absolute -top-3 left-2 z-20 pointer-events-none">
              <span className="inline-block rounded-full bg-accent px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white shadow-lg">
                {video.label}
              </span>
            </div>

            {/* Video container */}
            <div
              className="relative overflow-hidden rounded-2xl border border-white/30 backdrop-blur-xl transition-all duration-500 hover:border-accent/40 hover:shadow-2xl hover:shadow-accent/20"
              style={{
                background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                aspectRatio: '9/16'
              }}
            >
              {/* Decorative corner accent */}
              <div className="absolute right-0 top-0 h-16 w-16 opacity-20 pointer-events-none">
                <div className="absolute right-2 top-2 h-8 w-8 rounded-full bg-accent/30 blur-lg" />
              </div>

              <div className="relative h-full w-full p-1.5 z-10">
                <iframe
                  src={`https://www.youtube.com/embed/${video.youtubeId}?rel=0&modestbranding=1`}
                  title={video.label}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full rounded-lg relative z-10"
                  style={{ border: 'none', pointerEvents: 'auto' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
