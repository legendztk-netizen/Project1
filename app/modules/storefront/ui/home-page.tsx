import {
  ArrowRight,
  ChevronRight,
  ClipboardList,
  Gauge,
  PackageCheck,
  Ruler,
  Search,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Form, Link } from "react-router";

import { ClickToPlayVideo } from "./click-to-play-video";
import { StorefrontFooter } from "./storefront-footer";
import { StorefrontHeader } from "./storefront-header";
import "../styles/home.css";

const img = (name: string) => `/images/home/${name}`;

// Facts below come from the manufacturer brochure (2022 edition). Confirm each
// against current figures before publishing.
const proofStats = [
  { value: "80,000 m²", label: "Factory building area" },
  { value: "30+", label: "Countries supplied" },
  { value: "6", label: "Hose series at launch" },
  {
    compact: true,
    value: "JIC · NPT · ORFS · BSP",
    label: "Connection standards",
  },
];

const hoseSeries = [
  {
    code: "601R1",
    note: "One steel-wire braid",
    standard: "EN 853 1SN · SAE 100 R1AT",
  },
  {
    code: "601R2",
    note: "Two steel-wire braids",
    standard: "EN 853 2SN · SAE 100 R2AT",
  },
  {
    code: "EN1SC",
    note: "Compact, one braid",
    standard: "EN 857 1SC",
  },
  {
    code: "EN2SC",
    note: "Compact, two braids",
    standard: "EN 857 2SC",
  },
  {
    code: "EN4SP",
    note: "Four spiral layers",
    standard: "EN 856 4SP",
  },
  {
    code: "EN4SH",
    note: "Four spiral layers, heavy duty",
    standard: "EN 856 4SH",
  },
];

const steps = [
  {
    icon: Ruler,
    title: "Configure",
    body: "Pick a hose series, choose both ends and set the finished length. The configurator only offers compatible combinations.",
  },
  {
    icon: ClipboardList,
    title: "Request a quote",
    body: "Send your assembly for review. We confirm the details and reply with a Proforma Invoice, so nothing is charged online.",
  },
  {
    icon: PackageCheck,
    title: "We build and ship",
    body: "After payment clears, your assembly is made to order and shipped to your door, with a QR label on every assembly.",
  },
];

const factoryTiles = [
  {
    alt: "Steel wire braiding line in the hose factory",
    caption: "Wire braid production line",
    className: "is-wide",
    height: 236,
    src: img("factory-braid-line.jpg"),
    width: 424,
  },
  {
    alt: "Impulse pressure testing machine",
    caption: "Impulse pressure test bench",
    className: "",
    height: 222,
    src: img("test-pulse.jpg"),
    width: 336,
  },
  {
    alt: "Salt spray test chamber",
    caption: "Salt spray tester",
    className: "",
    height: 252,
    src: img("test-salt-spray.jpg"),
    width: 301,
  },
  {
    alt: "Long production hall with hose reels",
    caption: "Hose production hall",
    className: "is-panorama",
    height: 205,
    src: img("factory-workshop.jpg"),
    width: 653,
  },
];

const applications = [
  {
    height: 562,
    label: "Agriculture",
    src: img("app-agricultural.jpg"),
    width: 900,
  },
  {
    height: 960,
    label: "Construction",
    src: img("app-construction.jpg"),
    width: 720,
  },
  { height: 960, label: "Mining", src: img("app-mining.jpg"), width: 720 },
  { height: 960, label: "Oil & gas", src: img("app-oil.jpg"), width: 720 },
];

/** Adds scroll-in motion once the client is ready; content is visible without JS. */
function useScrollReveal() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    root.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);
  return rootRef;
}

export function HomePage({ appName }: { appName: string }) {
  const rootRef = useScrollReveal();
  return (
    <div
      className="storefront-shell home-page"
      data-surface="storefront"
      ref={rootRef}
    >
      <StorefrontHeader floating />
      <main>
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="home-hero-copy">
            <span className="home-eyebrow">
              Custom hydraulic hose assemblies
            </span>
            <h1 id="home-hero-title">Hydraulic hose, built to your length.</h1>
            <p>
              Choose the hose, pick both ends and set the length. Every assembly
              is made to order to your exact specification.
            </p>
            <div className="home-cta-row">
              <Link
                className="home-button home-button-primary"
                to="/build-a-hose"
              >
                Build a hose
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="home-link" to="/catalog">
                Browse products
                <ChevronRight aria-hidden="true" size={18} />
              </Link>
            </div>
            <Form
              className="home-search"
              action="/catalog"
              method="get"
              role="search"
            >
              <Search aria-hidden="true" size={18} />
              <label className="sr-only" htmlFor="home-search-query">
                Search products
              </label>
              <input
                id="home-search-query"
                name="q"
                placeholder="Search SKU, thread, standard or size"
                type="search"
              />
              <button type="submit">Search</button>
            </Form>
          </div>
          <div className="home-hero-media">
            <img
              alt="Cutaway of a four-layer spiral steel-wire hydraulic hose"
              decoding="async"
              fetchPriority="high"
              height={370}
              src={img("hose-en4sp.jpg")}
              width={1100}
            />
            <span className="home-media-note">
              Illustration – diameter and proportions vary by size
            </span>
          </div>
        </section>

        <section className="home-proof" aria-label="Manufacturing at a glance">
          <ul>
            {proofStats.map((stat) => (
              <li key={stat.label}>
                <strong className={stat.compact ? "is-compact" : undefined}>
                  {stat.value}
                </strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section" aria-labelledby="home-products-title">
          <header className="home-section-heading" data-reveal>
            <span className="home-eyebrow">Products</span>
            <h2 id="home-products-title">
              Everything for a complete assembly.
            </h2>
            <p>
              Start with the hose, add the ends, finish with the fittings.
              Compatible parts, one quote.
            </p>
          </header>
          <div className="home-product-grid">
            <article className="home-tile is-light is-hose" data-reveal>
              <div className="home-tile-copy">
                <span className="home-eyebrow">Hydraulic Hose</span>
                <h3>Braided and spiral steel-wire hose.</h3>
                <p>
                  Six launch series from one-braid 601R1 to four-layer spiral EN
                  856, in a range of sizes and pressure ratings.
                </p>
                <div className="home-tile-links">
                  <Link className="home-link" to="/catalog/hydraulic-hose">
                    Shop hydraulic hose
                    <ChevronRight aria-hidden="true" size={18} />
                  </Link>
                </div>
              </div>
              <img
                alt="Two-layer steel-wire braided hydraulic hose cutaway"
                height={322}
                loading="lazy"
                src={img("hose-en2sc.jpg")}
                width={971}
              />
            </article>

            <article className="home-tile is-steel is-ends" data-reveal>
              <div className="home-tile-copy">
                <span className="home-eyebrow">Hose Ends</span>
                <h3>The right end, first time.</h3>
                <p>
                  Swivel and fixed ends in straight, 45° and 90° for JIC, NPT,
                  ORFS and BSP threads.
                </p>
                <div className="home-tile-links">
                  <Link className="home-link" to="/catalog/hose-ends">
                    Shop hose ends
                    <ChevronRight aria-hidden="true" size={18} />
                  </Link>
                </div>
              </div>
              <img
                alt="JIC female swivel 90-degree hose end"
                height={702}
                loading="lazy"
                src={img("end-jic-90.jpg")}
                width={981}
              />
            </article>

            <article className="home-tile is-light is-fittings" data-reveal>
              <div className="home-tile-copy">
                <span className="home-eyebrow">Hydraulic Hose Fittings</span>
                <h3>Ferrules, adapters and quick couplers.</h3>
                <p>
                  The parts that finish the job, matched to the hose
                  construction they are made for.
                </p>
                <ul className="home-chip-list">
                  <li>
                    <Link to="/catalog/ferrules">Ferrules</Link>
                  </li>
                  <li>
                    <Link to="/catalog/adapters">Adapters</Link>
                  </li>
                  <li>
                    <Link to="/catalog/quick-couplers">Quick couplers</Link>
                  </li>
                </ul>
              </div>
              <img
                alt="Crimp ferrule"
                height={420}
                loading="lazy"
                src={img("fittings-ferrule.jpg")}
                width={460}
              />
            </article>
          </div>
        </section>

        <section
          className="home-section is-subtle"
          aria-labelledby="home-steps-title"
        >
          <header className="home-section-heading" data-reveal>
            <span className="home-eyebrow">How it works</span>
            <h2 id="home-steps-title">
              From spec to your door in three steps.
            </h2>
          </header>
          <ol className="home-steps">
            {steps.map((step, index) => (
              <li key={step.title} data-reveal>
                <span className="home-step-index">0{index + 1}</span>
                <step.icon aria-hidden="true" size={28} strokeWidth={1.6} />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="home-cta-row is-centered" data-reveal>
            <Link
              className="home-button home-button-primary"
              to="/build-a-hose"
            >
              Start building
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link className="home-link" to="/assembly-measurement-guide">
              How to measure your hose
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>

        <section
          className="home-section home-demo"
          aria-labelledby="home-demo-title"
        >
          <header className="home-section-heading" data-reveal>
            <span className="home-eyebrow">See it in action</span>
            <h2 id="home-demo-title">Build a Hose, start to finish.</h2>
            <p>
              Watch a 50-second walkthrough: choose your hose, pick both ends,
              set the length and request a quote.
            </p>
          </header>
          <div className="home-demo-frame" data-reveal>
            <ClickToPlayVideo
              caption="Watch the walkthrough"
              label="Build a Hose walkthrough, from choosing a hose to requesting a quote"
              poster="/video/customhoseco-build-poster.jpg"
              src="/video/customhoseco-build.mp4"
            />
          </div>
        </section>

        <section className="home-inside" aria-labelledby="home-inside-title">
          <img
            alt=""
            aria-hidden="true"
            className="home-inside-bg"
            height={576}
            loading="lazy"
            src={img("wire-braid.jpg")}
            width={871}
          />
          <div className="home-inside-inner">
            <header className="home-section-heading is-inverse" data-reveal>
              <span className="home-eyebrow">Hose series</span>
              <h2 id="home-inside-title">Engineered layer by layer.</h2>
              <p>
                Choose the reinforcement that matches your pressure and
                flexibility needs.
              </p>
            </header>
            <ul className="home-series" data-reveal>
              {hoseSeries.map((series) => (
                <li key={series.code}>
                  <strong>{series.code}</strong>
                  <span>{series.note}</span>
                  <small>{series.standard}</small>
                </li>
              ))}
            </ul>
            <Link
              className="home-link is-inverse"
              to="/catalog/hydraulic-hose"
              data-reveal
            >
              Compare all hose series
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>

        <section
          className="home-section home-factory"
          id="factory"
          aria-labelledby="home-factory-title"
        >
          <header className="home-section-heading" data-reveal>
            <span className="home-eyebrow">Our factory</span>
            <h2 id="home-factory-title">Made in a modern hose factory.</h2>
            <p>
              Braiding and spiral lines, a rubber mixing workshop and an
              in-house testing lab under one roof.
            </p>
          </header>
          <img
            alt="Aerial view of the hose factory campus"
            className="home-factory-aerial"
            data-reveal
            height={1114}
            loading="lazy"
            src={img("factory-aerial.jpg")}
            width={1800}
          />
          <ul className="home-factory-grid">
            {factoryTiles.map((tile) => (
              <li className={tile.className} key={tile.src} data-reveal>
                <img
                  alt={tile.alt}
                  height={tile.height}
                  loading="lazy"
                  src={tile.src}
                  width={tile.width}
                />
                <span>{tile.caption}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-video" aria-labelledby="home-video-title">
          <div className="home-video-inner">
            <div className="home-video-frame" data-reveal>
              <ClickToPlayVideo
                label="Hose being pressure tested in a test chamber"
                muted
                poster="/video/pressure-poster.jpg"
                src="/video/pressure.mp4"
              />
            </div>
            <div className="home-video-copy" data-reveal>
              <span className="home-eyebrow">Quality control</span>
              <h2 id="home-video-title">Tested where it is made.</h2>
              <p>
                Burst and impulse pressure benches, salt-spray and ozone ageing
                chambers, and a chemical lab sit next to the production lines.
              </p>
              <ul className="home-checklist">
                <li>
                  <Gauge aria-hidden="true" size={20} />
                  Burst and impulse pressure testing
                </li>
                <li>
                  <Gauge aria-hidden="true" size={20} />
                  Salt-spray, ozone and heat-ageing chambers
                </li>
                <li>
                  <Gauge aria-hidden="true" size={20} />
                  Tensile testing and rheometer analysis
                </li>
              </ul>
              <Link className="home-link is-inverse" to="/build-a-hose">
                Build your assembly
                <ChevronRight aria-hidden="true" size={18} />
              </Link>
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-apps-title">
          <header className="home-section-heading" data-reveal>
            <span className="home-eyebrow">Applications</span>
            <h2 id="home-apps-title">Built for machines that work hard.</h2>
          </header>
          <ul className="home-apps">
            {applications.map((application) => (
              <li key={application.label} data-reveal>
                <img
                  alt=""
                  height={application.height}
                  loading="lazy"
                  src={application.src}
                  width={application.width}
                />
                <span>{application.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-final-cta" aria-labelledby="home-cta-title">
          <div data-reveal>
            <h2 id="home-cta-title">Ready to build your hose assembly?</h2>
            <p>
              Configure it in minutes. No payment until you approve your
              Proforma Invoice.
            </p>
            <div className="home-cta-row is-centered">
              <Link
                className="home-button home-button-light"
                to="/build-a-hose"
              >
                Build a hose
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="home-link is-inverse" to="/quote-list">
                View quote list
                <ChevronRight aria-hidden="true" size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <StorefrontFooter appName={appName} />
    </div>
  );
}
