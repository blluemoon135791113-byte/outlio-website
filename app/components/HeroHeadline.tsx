export default function HeroHeadline() {
  return (
    <h1 className="text-[clamp(2.6rem,7.2vw,6.2rem)] font-bold uppercase leading-[0.98] tracking-tight">
      <span className="hero-main block">
        <span className="inline-block hero-text-slide">We</span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.1s" }}>
          book
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.2s" }}>
          the
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.3s" }}>
          meetings
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.4s" }}>
          for
        </span>{" "}
        {/*
          Width is reserved by `.hero-word-slot::before` in globals.css, NOT by
          a hidden span. A hidden span kept its text in the DOM, so the headline
          was copied and indexed as "…for tech startups.tech startups." — only
          one word may exist here.
        */}
        <span className="hero-word-slot whitespace-nowrap">
          <span className="text-accent">SaaS startups.</span>
        </span>
      </span>
    </h1>
  );
}
