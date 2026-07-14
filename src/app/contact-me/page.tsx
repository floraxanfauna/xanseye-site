import { SiteShell } from "@/components/SiteShell";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { ContactInquiryForm } from "@/components/ContactInquiryForm";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import styles from "../inner-page.module.css";

const contactFeatureImages = getPagePhotoUrls("contact-me");

export default function ContactPage() {
  return (
    <SiteShell currentPath="/contact-me">
      <main className={styles.main}>
        <section className={styles.contactHero}>
          <h2 className={styles.contactFormTitle}>INQUIRE</h2>
          <p className={styles.contactFormMeta}>Salt Lake City, UT</p>
        </section>

        <section className={styles.contactLayout}>
          <div className={styles.contactFormCard}>
            <ContactInquiryForm />
          </div>

          <aside className={styles.contactMapCard}>
            <div className={styles.mapBox}>
              <iframe
                title="Salt Lake City, Utah map"
                className={styles.mapFrame}
                src="https://www.google.com/maps?q=Salt+Lake+City,+Utah&output=embed"
                loading="lazy"
              />
            </div>
            <p className={styles.contactMapCaption}>Salt Lake City, UT</p>
          </aside>
        </section>

        <AutoGallerySlideshow
          images={contactFeatureImages}
          label="Contact feature slideshow"
          className={styles.accentSlideshow}
          intervalMs={3600}
        />
      </main>
    </SiteShell>
  );
}