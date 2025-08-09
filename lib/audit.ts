export const APP_NAME = "FEPY PDP Auditor Pro";

export const theme = {
  primary: {
    from: "from-indigo-600",
    to: "to-fuchsia-600",
    softFrom: "from-indigo-50",
    softTo: "to-fuchsia-50",
  },
  ok: { bg: "bg-emerald-100", text: "text-emerald-800", bar: "bg-emerald-500" },
  warn: { bg: "bg-amber-100", text: "text-amber-800", bar: "bg-amber-500" },
  danger: { bg: "bg-rose-100", text: "text-rose-800", bar: "bg-rose-500" },
};

export const normalizeUrl = (u: string) => {
  if (!u) return "";
  let s = ("" + u).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) return `https://${s}`;
  return "";
};

export const extractUrls = (text: string) => {
  const rows = text.replace(/\r/g, "").split(/\n|\t|,/).map(x => x.trim()).filter(Boolean);
  const noHeader = rows.filter(x => !/^url$/i.test(x));
  return noHeader.map(normalizeUrl).filter(Boolean);
};

export function mockFetchPdp(url: string) {
  const hash = Array.from(url).reduce((a, c) => a + c.charCodeAt(0), 0);
  const brand = hash % 3 === 0 ? "Philips" : hash % 3 === 1 ? "DeWalt" : "Atlas";
  const model = `MD-${(hash % 8999) + 100}`;
  const title = hash % 5 ? `${brand} ${model} Professional Tool, 220-240V` : `${model} Tool`;
  const bullets = [
    hash % 4 ? "High durability for daily use" : "lorem ipsum placeholder",
    "Quick installation",
    `${brand} regional warranty`,
  ];
  const specs = { Brand: brand, Model: model, Voltage: hash % 2 ? "220-240V" : "", Color: hash % 3 ? "Black" : "" };
  const images = Array.from({length: (hash % 5) + 1}, (_, i) => `${url}#img${i+1}`);
  const price = hash % 2 ? "49.00" : null;
  const about = hash % 3 ? `${brand} ${model} is designed for contractors seeking reliability and performance.` : "";
  return { url, title, bullets, specs, images, price, about };
}

export function draftFixes(pdp: ReturnType<typeof mockFetchPdp>) {
  const hasBrand = /philips|dewalt|atlas|bosch|makita/i.test(pdp.title||"");
  const hasModel = /MD-\d+|[A-Z0-9-]{3,}/.test(pdp.title||"");
  const len = (pdp.title||"").length;
  const lenOk = len>=80 && len<=140;
  const titleOk = hasBrand && hasModel && lenOk;

  const checks = [titleOk, true, true, true, true, true];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    passed: titleOk,
    score,
    title:{ok:titleOk,current:pdp.title,suggested:`${pdp.specs.Brand || 'Brand'} ${pdp.specs.Model || 'Model'} Professional Grade Tool | ${pdp.specs.Voltage || '220-240V'} | ${pdp.specs.Color || 'Color'}`,reason:"Title should contain brand, model, voltage, and color with length between 80–140 characters."},
    about:{ok:true,current:pdp.about,suggested:`${pdp.specs.Brand || 'Brand'} ${pdp.specs.Model || 'Model'} is built for professional use with reliable performance. Includes ${pdp.specs.Voltage || '220-240V'} power and ${pdp.specs.Color || 'color'} finish.`,reason:"About section should be descriptive and at least 60 characters."},
    bullets:{ok:true,current:pdp.bullets,suggested:["High durability for daily use","Quick installation","Backed by manufacturer warranty"],reason:"Provide 3–7 concise, benefit-led bullet points."},
    specs:{ok:true,current:pdp.specs,suggested:{...pdp.specs, Warranty:"1 Year"},reason:"Include all key specifications with correct values."},
    images:{ok:true,currentCount:pdp.images?.length||0,suggested:["Front view","Side view","Packaging"],reason:"Provide at least 3 clear product images."},
    price:{ok:true,current:pdp.price,suggested:pdp.price || "$0.00",reason:"Ensure price is visible or marked as RFQ."},
  };
}
