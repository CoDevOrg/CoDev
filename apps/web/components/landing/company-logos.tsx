import Image from "next/image";

const COMPANIES = [
  ["Cisco", "cisco.svg"],
  ["Salesforce", "salesforce.svg"],
  ["Google", "google.svg"],
  ["Amazon", "amazon.svg"],
  ["MongoDB", "mongodb.svg"],
  ["Autodesk", "autodesk.svg"],
  ["GovAI", "govai.png"],
  ["BMO", "bmo.svg"],
  ["University of Toronto", "uoft.png"],
] as const;

export function CompanyLogos() {
  return (
    <section className="lp-companies" aria-label="Waitlist community">
      <p>
        Developers on the CoDev waitlist work at these companies and
        institutions
      </p>
      <div>
        {COMPANIES.map(([name, file]) => (
          <Image
            key={name}
            src={`/brand/landing/${file}`}
            alt={name}
            width={120}
            height={48}
            className="lp-company-logo"
            unoptimized
          />
        ))}
      </div>
    </section>
  );
}
