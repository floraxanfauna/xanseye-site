import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import Image from "next/image";
import styles from "./page.module.css";

const youtubeId = "J1Sj2BqJtGw";
const homeImages = getPagePhotoUrls("home");
const homeFeatureImages = getPagePhotoUrls("home-featured");

export default function Home() {
  return (
    <SiteShell currentPath="/">
      <main className={styles.main}>
        <section className={styles.intro}>
          <h1 className={styles.introTitle}>Utah Based and World Traveling Destination Photograper</h1>
          <p className={styles.introSubtitle}>
            Professional Wedding, Family, Newborn, and Commercial Photography
          </p>
        </section>

        <AutoGallerySlideshow
          images={homeImages}
          label="Home gallery"
          className={styles.homeSlideshow}
          heroStyle
          showArrows
          pinFirstKeyword="FIRSTPHOTO"
        />

        <section className={styles.homeActionBand}>
          <div className={styles.heroActions}>
            <Link href="/pricing" className={styles.primaryAction}>
              View Pricing
            </Link>
            <Link href="/contact-me" className={styles.secondaryAction}>
              Inquire Now
            </Link>
          </div>

          <div className={styles.trustRow}>
            <article className={styles.trustItem}>
              <p className={styles.trustValue}>15+ Years</p>
              <p className={styles.trustLabel}>Professional Photography Experience</p>
            </article>
            <article className={styles.trustItem}>
              <p className={styles.trustValue}>700-2,000</p>
              <p className={styles.trustLabel}>Images Delivered for Full Wedding Coverage</p>
            </article>
            <article className={styles.trustItem}>
              <p className={styles.trustValue}>Utah + Destination</p>
              <p className={styles.trustLabel}>Available for Travel Sessions and Events</p>
            </article>
          </div>
        </section>

        <section className={styles.editorialFeature}>
          <div className={styles.editorialCopy}>
            <p className={styles.editorialEyebrow}>Editorial Recognition</p>
            <h2 className={styles.editorialTitle}>As Seen in VOGUE UK and Mummy Mag</h2>
            <p className={styles.editorialBody}>
              Signature photography with refined direction, authentic emotion, and timeless detail.
            </p>
          </div>
          <div className={styles.editorialImageWrap}>
            <Image
              src="/vogue-mummy.png"
              alt="Published spread featuring Xan's Eye work"
              width={960}
              height={690}
              className={styles.editorialImage}
            />
          </div>
        </section>

        <AutoGallerySlideshow
          images={homeFeatureImages}
          label="Home feature slideshow"
          className={styles.accentSlideshow}
          intervalMs={3600}
        />

        <section className={styles.offeringsSection}>
          <p className={styles.offeringsEyebrow}>Signature Offerings</p>
          <h3 className={styles.offeringsTitle}>Photography Experiences Crafted Around Your Story</h3>

          <div className={styles.offeringsGrid}>
            <article className={styles.offeringCard}>
              <h4 className={styles.offeringTitle}>Weddings + Elopements</h4>
              <p className={styles.offeringBody}>
                Full-day storytelling coverage with elevated portraits, candid moments, and timeless
                detail work.
              </p>
              <Link href="/weddings" className={styles.offeringLink}>
                Explore Wedding Coverage
              </Link>
            </article>

            <article className={styles.offeringCard}>
              <h4 className={styles.offeringTitle}>Family + Lifestyle</h4>
              <p className={styles.offeringBody}>
                Genuine, connection-driven sessions designed to preserve the season of life you are
                in right now.
              </p>
              <Link href="/pricing" className={styles.offeringLink}>
                View Session Pricing
              </Link>
            </article>

            <article className={styles.offeringCard}>
              <h4 className={styles.offeringTitle}>Newborn + Maternity</h4>
              <p className={styles.offeringBody}>
                Soft, intimate imagery with a guided approach that keeps your session relaxed and
                naturally beautiful.
              </p>
              <Link href="/contact-me" className={styles.offeringLink}>
                Reserve Your Date
              </Link>
            </article>
          </div>
        </section>

        <section className={styles.videoSection}>
          <iframe
            className={styles.videoFrame}
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${youtubeId}&controls=1&rel=0`}
            title="Xan's Eye Photography video"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <a
            className={styles.videoLink}
            href={`https://www.youtube.com/watch?v=${youtubeId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch on YouTube
          </a>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.finalCtaEyebrow}>Ready to Begin?</p>
          <h3 className={styles.finalCtaTitle}>Let&apos;s Plan a Session That Feels Like You</h3>
          <p className={styles.finalCtaBody}>
            Tell me your vision, timeline, and location. I&apos;ll guide the rest.
          </p>
          <Link href="/contact-me" className={styles.primaryAction}>
            Book Your Consultation
          </Link>
        </section>
      </main>
    </SiteShell>
  );
}
