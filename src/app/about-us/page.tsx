import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import styles from "../inner-page.module.css";

const aboutImages = getPagePhotoUrls("about-us");

export default function AboutPage() {
  return (
    <SiteShell currentPath="/about-us">
      <main className={styles.main}>
        <section className={styles.aboutEditorialLayout}>
          <div className={styles.aboutPortraitColumn}>
            <figure className={styles.aboutPortraitFrame}>
              <Image
                src="/page-photos/about-us/xan-hope-portrait.png"
                alt="Portrait of Xan"
                width={2048}
                height={1365}
                className={styles.aboutPortraitImage}
                priority
              />
            </figure>

            <p className={styles.aboutSideLink}>Find me on Instagram!</p>
            <h3 className={styles.aboutSocialsTitle}>Socials</h3>
            <p className={styles.aboutSocial}>
              <a href="https://instagram.com/xanseye" target="_blank" rel="noreferrer" className={styles.aboutSocialLink}>
                @Xanseye
              </a>
            </p>
            <p className={styles.aboutSocial}>
              <a
                href="https://instagram.com/restoringphotography"
                target="_blank"
                rel="noreferrer"
                className={styles.aboutSocialLink}
              >
                @RestoringPhotography
              </a>
            </p>
          </div>

          <div className={styles.aboutBioColumn}>
            <h2 className={styles.pageTitle}>ABOUT XAN</h2>
            <p className={styles.textBody}>
              &quot;I BELIEVE IN A UNIQUE AND CUSTOMIZED EXPERIENCE FOR EACH AND EVERY CLIENT.&quot;
            </p>
            <p className={styles.textBody}>
              Xan (Short for Alexandra) was born in Utah and also grew up in Washington, Nevada,
              and Japan. She has been playing the piano since before she could read, and started
              the cello in 3rd grade. In junior high school, she added mallet percussion to her
              list of musical talents. Her passion for photography and cinematography was awakened
              in Japan, while she worked as a model for 2 years. Returning from Japan, Xan enrolled
              in college at BYU-Idaho, where she explored both Graphic Design and Music Performance
              (in piano, cello, and mallet percussion). Then, pursuing a career in real estate, Xan
              returned to Utah from college, where she worked as a licensed Real Estate agent for
              10+ years.
            </p>
            <p className={styles.textBody}>
              During this time, Xan used her modeling experience to work as a double for Vanessa
              Hudgens on the film set of High School Musical 3. On the movie set, Xan was captivated
              by the magic behind the camera. Following that passion, she shadowed numerous feature
              film cinematographers and famous wedding videographers, and began exploring still
              photography.
            </p>
            <p className={styles.textBody}>
              After moving to upstate New York and training with a big Wedding Photography company
              there, she found her photography truly blooming. She has spent the last 15+ years
              honing her photography skills and has grown her business as a wedding photographer on
              the east coast dramatically. In her busy years as a photographer she has shot over 20
              weddings spanning from New Orleans to Seattle.
            </p>
            <p className={styles.textBody}>
              Her photography has also been featured in two European magazines, Mummy Mag, and Vogue
              UK, as well as many wedding, and local magazines!
            </p>
            <p className={styles.textBody}>
              Xan has a reverence for photography and the ability it has to capture truly special
              moments, saying &quot;photography is timeless, and the ability to truly isolate the
              feeling of a moment lies within the ability to capture genuine people when they are
              their most true and tender selves. Capturing those memories is never more important
              than when you are able to look back at photographs to pull almost forgotten feelings
              back to the surface of your life.&quot;
            </p>
            <p className={styles.textBody}>Xan and her kids now live in Salt Lake City, UT</p>
            <p className={styles.textBody}>
              Xan is slowly starting her photography business back up again and is excited to begin
              taking new clients!
            </p>
            <p className={styles.aboutFormerName}>(Previously Xan Craven)</p>
            <p className={styles.aboutBrand}>Xan Hope Photography</p>
            <Link href="/contact-me" className={styles.aboutContactLink}>
              Say Hello
            </Link>
          </div>
        </section>

        <hr className={styles.sectionRule} />

        <section className={styles.aboutGallerySection}>
          <p className={styles.aboutGalleryEyebrow}>Recent Work</p>
          <h3 className={styles.aboutGalleryTitle}>Photo Gallery</h3>
          <AutoGallerySlideshow
            images={aboutImages}
            label="About gallery"
            className={styles.aboutGallerySlideshow}
          />
        </section>
      </main>
    </SiteShell>
  );
}
