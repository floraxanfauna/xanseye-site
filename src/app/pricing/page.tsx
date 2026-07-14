import { SiteShell } from "@/components/SiteShell";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import styles from "../inner-page.module.css";

const pricingImages = getPagePhotoUrls("pricing");
const pricingImagesAlt = [...pricingImages].reverse();
const pricingFeatureImages = getPagePhotoUrls("pricing-featured");

export default function PricingPage() {
  return (
    <SiteShell currentPath="/pricing">
      <main className={styles.main}>
        <section className={styles.pricingSplitLayout}>
          <div className={styles.pricingTextColumn}>
            <h2 className={styles.pageTitle}>PRICING</h2>

            <h3 className={styles.pricingSectionTitle}>NORMAL SESSION INFO:</h3>
            <p className={styles.pricingBody}>
              Normal sessions are between 45 minutes to an hour unless otherwise specified. I usually
              can get you between 200-400 photos per 45 minute session! My style is more focused on
              documenting fun candid moments and interactions with you and getting some gorgeous posed
              shots as well! Please feel free to let me know if you are hoping to have a certain look
              in your photos and I&apos;d love to help make that happen! <span className={styles.pricingGreenLine}>I do not offer discounts on mini sessions.</span>
            </p>

            <p className={styles.pricingBoldBody}>
              Included in the price are the rights and a copy of ALL the digital images sent to you in
              an online gallery with a link that will allow you to download them all to your computer.&lt;
            </p>

            <p className={styles.pricingBody}>
              Please let me know if you do not want your photos posted on Social Media.
            </p>

            <a
              href="https://xancraven.smugmug.com"
              target="_blank"
              rel="noreferrer"
              className={styles.pricingGalleryButton}
            >
              View My Past Shoots
            </a>

            <ul className={styles.pricingList}>
              <li>Couples Photos: $300</li>
              <li>Family Photos: $450 (family mini session 20-30 mins: $250)</li>
              <li>Senior Photos: $415</li>
              <li>Bridals: $300</li>
              <li>Boudoir Session: $585</li>
              <li>Business Head Shots: $175 (between 65-200 images)</li>
              <li>At Home Newborn: $300</li>
              <li>Maternity: $450</li>
              <li>Newborn Home + Maternity: $625</li>
              <li>Labor + Hospital or Home Photos: $750 (for 3 hours that can be broken up)</li>
              <li>Newborn Home + Mini Hospital Session (15 mins): $435</li>
              <li>Newborn Home + Mini Hospital Session (15 mins) + Maternity: $900</li>
              <li>
                Little Kid Photo Birthday/Milestone Shoots: $350 for a 20-30 minute shoot or $525 for
                1 hour (single child / birthday shoot)
              </li>
            </ul>
          </div>

          <div className={styles.pricingMediaColumn}>
            <AutoGallerySlideshow
              images={pricingImages}
              label="Pricing slideshow one"
              className={styles.pricingSlideshow}
            />
            <AutoGallerySlideshow
              images={pricingImagesAlt}
              label="Pricing slideshow two"
              className={styles.pricingSlideshow}
              intervalMs={2900}
            />
          </div>
        </section>

        <AutoGallerySlideshow
          images={pricingFeatureImages}
          label="Pricing feature slideshow"
          className={styles.accentSlideshow}
          intervalMs={3500}
        />
      </main>
    </SiteShell>
  );
}