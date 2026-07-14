import { SiteShell } from "@/components/SiteShell";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import styles from "../inner-page.module.css";

const weddingImages = getPagePhotoUrls("weddings");
const weddingFeatureImages = getPagePhotoUrls("weddings-featured");

export default function WeddingsPage() {
  return (
    <SiteShell currentPath="/weddings">
      <main className={styles.main}>
        <section className={styles.splitLayout}>
          <div className={styles.leftStack}>
            <h2 className={styles.pageTitle}>PRICING</h2>
            <p className={styles.weddingPromo}>Now booking Weddings for the Salt Lake City, UT area!</p>

            <p className={styles.weddingUnderlineTitle}>Standard Salt Lake City, UT Weddings:</p>
            <p className={styles.textBody}>All packages can be customizable!</p>

            <p className={styles.textHeading}>ALL PACKAGES:</p>
            <p className={styles.textBody}>
              ($75 fee for every 30 minutes of travel time outside of Salt Lake City, UT. but within the
              state)
            </p>

            <p className={styles.packageA}>Package A:</p>
            <p className={styles.textBodyStrong}>
              $1,100 for 5 hours ($200 for every extra hour up to 7 hours)
            </p>
            <p className={styles.textBody}>or $225 hourly for anything under 3 hours</p>
            <p className={styles.textBody}>
              no album just all of the digital images sent in an online, downloadable gallery.
            </p>

            <p className={styles.packageB}>Package B:</p>
            <p className={styles.textBodyStrong}>
              $1,750 for up to 8 hours ($200 for every extra hour up to 10 hours)
            </p>
            <p className={styles.textBody}>
              Includes: A First Look Shoot or Engagement Shoot before the wedding day.
            </p>
            <p className={styles.weddingUnderlineTitle}>Optional Add Ons:</p>
            <p className={styles.textBody}>
              + $100 A Bride and Groom Simple Modern Water bottles filled with a liquid of your
              choosing for me to bring on the wedding day
            </p>
            <p className={styles.textBody}>+ $450 A 40 page Hard Cover Album from Artifact Uprising</p>
          </div>

          <div className={styles.rightStack}>
            <AutoGallerySlideshow
              images={weddingImages}
              label="Weddings slideshow"
              className={styles.pageSlideshow}
            />

            <p className={styles.weddingUnderlineTitle}>Details:</p>
            <p className={styles.textBody}>
              This day is about you! I will be as adaptable and flexible to your needs as
              possible! You let me know what you are looking for and I will capture and
              accommodate you! You get all the rights to the digital images to print and do
              anything you like with. You will get your very own gallery online that you can send
              and share with all of your friends and family and print at your leisure!
            </p>

            <p className={styles.weddingPerksTitle}>Perks of using Me to shoot your Wedding!</p>
            <ul className={styles.weddingPerksList}>
              <li>You get 10-20 images from your wedding texted to you on the evening or the very next day after your wedding!</li>
              <li>
                The rest of your digital images will be emailed to you within 3 weeks of your
                wedding! (3-5 weeks between June-October Weddings)
              </li>
              <li>
                I will capture more details than you will even realize from your big day! Most
                clients get between 700-2,000 images! You will never forget a single moment!
              </li>
            </ul>
          </div>
        </section>

        <AutoGallerySlideshow
          images={weddingFeatureImages}
          label="Weddings feature slideshow"
          className={styles.accentSlideshow}
          intervalMs={3500}
        />
      </main>
    </SiteShell>
  );
}