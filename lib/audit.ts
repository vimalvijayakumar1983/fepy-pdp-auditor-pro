export const APP_NAME = "FEPY PDP Auditor Pro";

// ---- Utility rules ----
function normalize(s?: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function hasBrandModel(title: string) {
  // Detects Brand + Model like "Philips MD-1234" or any 3+ alnum block
  const hasBrand = /(philips|dewalt|atlas|bosch|makita|black & decker|black+decker)/i.test(title);
  const hasModel = /(MD-\d+)|([A-Z0-9-]{3,})/.test(title);
  return { hasBrand, hasModel, ok: hasBrand && hasModel };
}
function inRange(n: number, min: number, max: number) {
  return n >= min && n <= max;
}
function pick<T>(arr: T[], n: number) {
  return [...(arr || [])].slice(0, n);
}

type Extracted = {
  url: string;
  title?: string;
  about?: string;
  bullets?: string[];
  specs?: Record<string,string>;
  images?: string[];
  price?: string | null;
};

export function buildAuditFromExtracted(pdp: Extracted) {
  const title = normalize(pdp.title);
  const about = normalize(pdp.about);
  const bullets = (pdp.bullets || []).map(normalize).filter(Boolean);
  const specs = Object.fromEntries(
    Object.entries(pdp.specs || {}).map(([k, v]) => [normalize(k), normalize(v)])
  );
  const images = pdp.images || [];
  const price = pdp.price ?? null;

  // Title rules
  const titleLen = title.length;
  const { ok: hasBM } = hasBrandModel(title);
  const titleLenOk = inRange(titleLen, 80, 140);
  const titleOk = hasBM && titleLenOk;

  // About rules
  const aboutOk = about.length >= 60;

  // Bullets rules
  const bulletsOk = bullets.length >= 3 && bullets.length <= 7;

  // Specs rules (Brand/Model/Voltage/Color if present)
  const keySpecNames = ["Brand", "Model", "Voltage", "Color"];
  const presentKeys = keySpecNames.filter((k) => specs[k]);
  const specsOk = presentKeys.length >= 2; // relax for generic pages

  // Images rules
  const imagesOk = images.length >= 3;

  // Price rule
  const priceOk = !!price;

  // Score (simple % of passed checks)
  const checks = [titleOk, aboutOk, bulletsOk, specsOk, imagesOk, priceOk];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  // Suggestions (fallbacks use whatever we could parse)
  const suggestedTitle =
    titleOk
      ? title
      : `${specs["Brand"] || "Brand"} ${specs["Model"] || "Model"} Professional Grade Tool | ${specs["Voltage"] || "220-240V"} | ${specs["Color"] || "Color"}`;

  const suggestedAbout =
    aboutOk
      ? about
      : `${specs["Brand"] || "Brand"} ${specs["Model"] || "Model"} is built for professional use with reliable performance. Includes ${specs["Voltage"] || "220-240V"} power and ${specs["Color"] || "color"} finish.`;

  const suggestedBullets =
    bulletsOk
      ? bullets
      : [
          "High durability for daily use",
          "Quick installation",
          "Backed by manufacturer warranty",
        ];

  const suggestedSpecs = { ...specs };
  if (!suggestedSpecs["Warranty"]) suggestedSpecs["Warranty"] = "1 Year";

  const suggestedImages =
    imagesOk ? images : pick(images.length ? images : ["Front view", "Side view", "Packaging"], 3);

  const suggestedPrice = price || null;

  return {
    passed: score >= 80,   // you can tune this threshold
    score,
    title: {
      ok: titleOk,
      current: title,
      suggested: suggestedTitle,
      reason:
        "Title should include brand + model and be 80–140 characters.",
    },
    about: {
      ok: aboutOk,
      current: about,
      suggested: suggestedAbout,
      reason: "About/description should be descriptive (≥ 60 characters).",
    },
    bullets: {
      ok: bulletsOk,
      current: bullets,
      suggested: suggestedBullets,
      reason: "Provide 3–7 concise, benefit-led bullet points.",
    },
    specs: {
      ok: specsOk,
      current: specs,
      suggested: suggestedSpecs,
      reason: "Include key specs like Brand, Model, Voltage, Color, Warranty.",
    },
    images: {
      ok: imagesOk,
      currentCount: images.length,
      suggested: suggestedImages,
      reason: "Provide at least 3 clear product images.",
    },
    price: {
      ok: priceOk,
      current: price,
      suggested: suggestedPrice,
      reason: "Ensure a visible price or clearly mark RFQ.",
    },
  };
}
